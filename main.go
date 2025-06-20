package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

type Message struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

type SSHConnection struct {
	client   *ssh.Client
	session  *ssh.Session
	stdin    io.WriteCloser
	stdout   io.Reader
	stderr   io.Reader
	ws       *websocket.Conn
	username string
	mu       sync.Mutex
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// In production, implement proper origin checking
		return true
	},
}

func main() {
	http.HandleFunc("/", serveHome)
	http.HandleFunc("/ws", handleWebSocket)
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static/"))))

	log.Println("Web server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func serveHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.Error(w, "Not found", 404)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	http.ServeFile(w, r, "static/index.html")
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Print("upgrade failed: ", err)
		return
	}
	defer conn.Close()

	// Handle WebSocket connection
	sshConn := &SSHConnection{ws: conn}
	
	for {
		var msg Message
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println("read error:", err)
			break
		}

		switch msg.Type {
		case "connect":
			var authData struct {
				Username string `json:"username"`
				Password string `json:"password"`
			}
			if err := json.Unmarshal([]byte(msg.Data), &authData); err != nil {
				sshConn.sendMessage("error", "Invalid auth data")
				continue
			}
			
			if err := sshConn.connectSSH(authData.Username, authData.Password); err != nil {
				sshConn.sendMessage("error", fmt.Sprintf("SSH connection failed: %v", err))
				continue
			}
			
			sshConn.sendMessage("connected", "Successfully connected to SSH Battle!")
			
		case "input":
			if sshConn.stdin != nil {
				sshConn.mu.Lock()
				sshConn.stdin.Write([]byte(msg.Data))
				sshConn.mu.Unlock()
			}
			
		case "disconnect":
			sshConn.disconnect()
			return
		}
	}
	
	sshConn.disconnect()
}

func (sc *SSHConnection) connectSSH(username, password string) error {
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // In production, implement proper host key verification
		Timeout:         10 * time.Second,
	}

	client, err := ssh.Dial("tcp", "localhost:2222", config)
	if err != nil {
		return fmt.Errorf("failed to connect to SSH server: %v", err)
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return fmt.Errorf("failed to create SSH session: %v", err)
	}

	// Set up terminal modes
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", 500, 50, modes); err != nil {
		session.Close()
		client.Close()
		return fmt.Errorf("request for pseudo terminal failed: %v", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return fmt.Errorf("unable to setup stdin for session: %v", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		stdin.Close()
		session.Close()
		client.Close()
		return fmt.Errorf("unable to setup stdout for session: %v", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		stdin.Close()
		session.Close()
		client.Close()
		return fmt.Errorf("unable to setup stderr for session: %v", err)
	}

	sc.client = client
	sc.session = session
	sc.stdin = stdin
	sc.stdout = stdout
	sc.stderr = stderr
	sc.username = username

	// Start the shell
	if err := session.Shell(); err != nil {
		sc.disconnect()
		return fmt.Errorf("failed to start shell: %v", err)
	}

	// Start goroutines to handle I/O
	go sc.handleSSHOutput()
	go sc.handleSSHErrors()

	return nil
}

func (sc *SSHConnection) handleSSHOutput() {
	buffer := make([]byte, 1024)
	for {
		n, err := sc.stdout.Read(buffer)
		if err != nil {
			if err != io.EOF {
				log.Printf("Error reading SSH stdout: %v", err)
			}
			break
		}
		
		if n > 0 {
			sc.sendMessage("output", string(buffer[:n]))
		}
	}
}

func (sc *SSHConnection) handleSSHErrors() {
	buffer := make([]byte, 1024)
	for {
		n, err := sc.stderr.Read(buffer)
		if err != nil {
			if err != io.EOF {
				log.Printf("Error reading SSH stderr: %v", err)
			}
			break
		}
		
		if n > 0 {
			sc.sendMessage("error", string(buffer[:n]))
		}
	}
}

func (sc *SSHConnection) sendMessage(msgType, data string) {
	msg := Message{
		Type: msgType,
		Data: data,
	}
	
	sc.mu.Lock()
	defer sc.mu.Unlock()
	
	if sc.ws != nil {
		sc.ws.WriteJSON(msg)
	}
}

func (sc *SSHConnection) disconnect() {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	
	if sc.stdin != nil {
		sc.stdin.Close()
		sc.stdin = nil
	}
	
	if sc.session != nil {
		sc.session.Close()
		sc.session = nil
	}
	
	if sc.client != nil {
		sc.client.Close()
		sc.client = nil
	}
}
