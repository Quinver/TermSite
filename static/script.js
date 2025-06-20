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

function calculateTerminalSize() {
  // Calculate the number of columns and rows based on browser size
  const container = document.getElementById("terminal");
  if (!container) return { cols: 80, rows: 24 };

  // Use a test character to measure font dimensions
  const testEl = document.createElement('div');
  testEl.style.position = 'absolute';
  testEl.style.visibility = 'hidden';
  testEl.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
  testEl.style.fontSize = '15px';
  testEl.style.lineHeight = '1.2';
  testEl.textContent = 'M'; // Use 'M' as it's typically the widest character
  document.body.appendChild(testEl);

  const charWidth = testEl.offsetWidth;
  const charHeight = testEl.offsetHeight;
  document.body.removeChild(testEl);

  // Calculate terminal dimensions
  const containerWidth = window.innerWidth;
  const containerHeight = window.innerHeight;
  
  const cols = Math.floor(containerWidth / charWidth) - 2; // Leave some margin
  const rows = Math.floor(containerHeight / charHeight) - 2; // Leave some margin

  return {
    cols: Math.max(cols, 80), // Minimum 80 columns
    rows: Math.max(rows, 24)  // Minimum 24 rows
  };
}

function initializeTerminal() {
  const terminalContainer = document.getElementById("terminal");
  if (!terminalContainer) return; // Skip if not on terminal page

  // Calculate initial terminal size
  const { cols, rows } = calculateTerminalSize();

  // Initialize xterm.js with dynamic sizing
  term = new Terminal({
    cols: cols,
    rows: rows,
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    fontSize: 15,
    lineHeight: 1.2,
    theme: {
      background: '#000000',
      foreground: '#ffffff'
    }
  });
  
  term.open(terminalContainer);
  term.focus(); // Auto-focus terminal on load

  // Handle window resize
  function handleResize() {
    const newSize = calculateTerminalSize();
    term.resize(newSize.cols, newSize.rows);
    
    // Notify the SSH server about the terminal size change if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "resize",
        data: JSON.stringify({
          cols: newSize.cols,
          rows: newSize.rows
        })
      }));
    }
  }

  // Debounce resize events
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 100);
  });

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
          cols: cols,
          rows: rows
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
