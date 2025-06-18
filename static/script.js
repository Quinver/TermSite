let ws = null;
let term = null;

function initializeLogin() {
  const connectBtn = document.getElementById("connect-btn");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  if (!connectBtn) return; // Skip if not on login page

  connectBtn.addEventListener("click", () => {
    if (!usernameInput.value) {
      alert("Username is required!");
      return;
    }

    // Store credentials in sessionStorage for fullscreen page
    sessionStorage.setItem("username", usernameInput.value);
    sessionStorage.setItem("password", passwordInput.value);

    // Redirect to fullscreen terminal
    window.location.href = "/static/fullscreen.html";
  });
}

function initializeTerminal() {
  const terminalContainer = document.getElementById("terminal");
  if (!terminalContainer) return; // Skip if not on terminal page

  // Initialize xterm.js
  term = new Terminal({
    cols: 80,
    rows: 24,
    convertEol: true,
    cursorBlink: true,
  });
  term.open(terminalContainer);
  term.focus(); // Auto-focus terminal on load

  // Connect to WebSocket
  ws = new WebSocket("ws://" + window.location.host + "/ws");

  ws.onopen = () => {
    // Send authentication data from sessionStorage
    ws.send(
      JSON.stringify({
        type: "connect",
        data: JSON.stringify({
          username: sessionStorage.getItem("username"),
          password: sessionStorage.getItem("password"),
        }),
      }),
    );
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case "output":
        term.write(msg.data);
        break;
      case "error":
        // Handle SSH connection failure
        if (msg.data.includes("SSH connection failed")) {
          term.write(
            "\r\nError: Invalid username or password. New users: choose a unique username and leave password empty.\r\n",
          );
        } else {
          term.write("\r\nError: " + msg.data + "\r\n");
        }
        // Redirect back to login after a short delay
        setTimeout(() => {
          window.location.href = "/static/index.html";
        }, 2000);
        break;
      case "connected":
        term.write("\r\n" + msg.data + "\r\n");
        break;
    }
  };

  ws.onclose = () => {
    term.write("\r\nDisconnected from SSH Battle.\r\n");
    // Redirect back to login page
    window.location.href = "/static/index.html";
  };

  ws.onerror = (error) => {
    term.write("\r\nWebSocket error: " + error + "\r\n");
    window.location.href = "/static/index.html";
  };

  // Handle terminal input
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "input",
          data: data,
        }),
      );
    }
  });
}

// Initialize based on current page
if (document.getElementById("connect-btn")) {
  initializeLogin();
} else if (document.getElementById("terminal")) {
  initializeTerminal();
}
