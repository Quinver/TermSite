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

  // Force container to full size first
  container.style.width = '100vw';
  container.style.height = '100vh';

  // Use xterm.js default font metrics (more reliable)
  const charWidth = 7.234375; // Default xterm.js character width
  const charHeight = 17; // Default xterm.js line height
  
  // Get actual viewport dimensions
  const containerWidth = window.innerWidth;
  const containerHeight = window.innerHeight;
  
  // Calculate terminal dimensions with no margin to maximize space
  const cols = Math.floor(containerWidth / charWidth);
  const rows = Math.floor(containerHeight / charHeight);

  console.log(`Terminal size: ${cols}x${rows} (${containerWidth}x${containerHeight})`);

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
    fontFamily: 'courier-new, courier, monospace',
    fontSize: 15,
    lineHeight: 1.0,
    theme: {
      background: '#000000',
      foreground: '#ffffff'
    },
    allowTransparency: false
  });
  
  term.open(terminalContainer);
  
  // Force fit to container after opening
  setTimeout(() => {
    if (term.element) {
      term.element.style.width = '100%';
      term.element.style.height = '100%';
    }
    term.focus();
  }, 100);

  // Handle window resize
  function handleResize() {
    const newSize = calculateTerminalSize();
    term.resize(newSize.cols, newSize.rows);
    
    // Force element sizing after resize
    setTimeout(() => {
      if (term.element) {
        term.element.style.width = '100vw';
        term.element.style.height = '100vh';
      }
    }, 50);
    
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

  // Also handle orientation change on mobile
  window.addEventListener('orientationchange', () => {
    setTimeout(handleResize, 200);
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
