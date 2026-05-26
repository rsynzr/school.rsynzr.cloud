(function () {
  "use strict";

  const CONFIG = {
    // Isi manual setelah Worker aktif, contoh:
    // API_URL: "https://rsynzr-ai.your-subdomain.workers.dev/chat",
    API_URL: "",
    DEFAULT_SYSTEM_PROMPT: "Kamu adalah rsynzr-ai, asisten AI yang ringkas, akurat, ramah, dan menjawab dalam bahasa pengguna.",
    DEFAULT_TEMPERATURE: 0.7,
    MAX_MESSAGES_TO_SEND: 30,
    MAX_INPUT_LENGTH: 6000,
    STORAGE_KEYS: {
      messages: "rsynzr-ai.messages.v1",
      settings: "rsynzr-ai.settings.v1"
    }
  };

  const dom = {
    form: document.getElementById("chatForm"),
    input: document.getElementById("messageInput"),
    sendButton: document.getElementById("sendButton"),
    messages: document.getElementById("messages"),
    template: document.getElementById("messageTemplate"),
    clearChat: document.getElementById("clearChat"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsPanel: document.getElementById("settingsPanel"),
    endpointInput: document.getElementById("endpointInput"),
    systemPrompt: document.getElementById("systemPrompt"),
    temperatureInput: document.getElementById("temperatureInput"),
    temperatureValue: document.getElementById("temperatureValue"),
    statusLine: document.getElementById("statusLine")
  };

  const state = {
    messages: [],
    isSending: false,
    settings: {
      endpoint: CONFIG.API_URL,
      systemPrompt: CONFIG.DEFAULT_SYSTEM_PROMPT,
      temperature: CONFIG.DEFAULT_TEMPERATURE
    }
  };

  init();

  function init() {
    loadState();
    bindEvents();
    syncSettingsInputs();

    if (state.messages.length === 0) {
      state.messages.push({
        role: "assistant",
        content: "Halo, saya rsynzr-ai. Ada yang bisa saya bantu?",
        createdAt: new Date().toISOString()
      });
    }

    renderMessages();
    resizeTextarea();
    updateSendState();
  }

  function bindEvents() {
    dom.form.addEventListener("submit", handleSubmit);
    dom.input.addEventListener("input", function () {
      resizeTextarea();
      updateSendState();
    });

    dom.input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        dom.form.requestSubmit();
      }
    });

    dom.clearChat.addEventListener("click", clearChat);
    dom.settingsToggle.addEventListener("click", toggleSettings);
    dom.endpointInput.addEventListener("input", saveSettingsFromInputs);
    dom.systemPrompt.addEventListener("input", saveSettingsFromInputs);
    dom.temperatureInput.addEventListener("input", saveSettingsFromInputs);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (state.isSending) return;

    const content = sanitizeInput(dom.input.value);
    if (!content) {
      setStatus("Pesan masih kosong.", true);
      return;
    }

    const endpoint = getEndpoint();
    if (!endpoint) {
      setStatus("Isi Worker endpoint di panel settings atau CONFIG.API_URL pada script.js.", true);
      dom.settingsPanel.hidden = false;
      dom.settingsToggle.setAttribute("aria-expanded", "true");
      dom.endpointInput.focus();
      return;
    }

    const userMessage = {
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };

    state.messages.push(userMessage);
    dom.input.value = "";
    resizeTextarea();
    setSending(true);
    setStatus("");
    renderMessages();
    persistMessages();

    const loadingMessage = addLoadingMessage();

    try {
      const reply = await requestAssistantReply(endpoint);
      removeMessageElement(loadingMessage);

      const assistantMessage = {
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString()
      };

      state.messages.push(assistantMessage);
      persistMessages();
      await appendMessageWithTyping(assistantMessage);
    } catch (error) {
      removeMessageElement(loadingMessage);
      const safeMessage = error instanceof Error ? error.message : "Terjadi kesalahan. Coba lagi nanti.";
      setStatus(safeMessage, true);
    } finally {
      setSending(false);
      updateSendState();
      dom.input.focus();
    }
  }

  async function requestAssistantReply(endpoint) {
    const messagesForApi = state.messages
      .filter(function (message) {
        return message.role === "user" || message.role === "assistant";
      })
      .slice(-CONFIG.MAX_MESSAGES_TO_SEND)
      .map(function (message) {
        return {
          role: message.role,
          content: message.content
        };
      });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messagesForApi,
        system: state.settings.systemPrompt,
        temperature: Number(state.settings.temperature)
      })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error("Respons backend tidak valid.");
    }

    if (!response.ok) {
      throw new Error(payload && payload.error ? payload.error : "AI belum bisa merespons saat ini.");
    }

    if (!payload || typeof payload.reply !== "string" || !payload.reply.trim()) {
      throw new Error("AI mengirim respons kosong.");
    }

    return payload.reply.trim();
  }

  function addLoadingMessage() {
    const element = createMessageElement({
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    });
    const bubble = element.querySelector(".bubble");
    bubble.innerHTML = '<span class="typing" aria-label="AI sedang berpikir"><span></span><span></span><span></span></span>';
    dom.messages.appendChild(element);
    scrollToBottom();
    return element;
  }

  async function appendMessageWithTyping(message) {
    const element = createMessageElement(message);
    const bubble = element.querySelector(".bubble");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bubble.innerHTML = "";
    dom.messages.appendChild(element);

    if (prefersReducedMotion || message.content.length > 1800) {
      bubble.innerHTML = renderMarkdown(message.content);
      scrollToBottom();
      return;
    }

    let index = 0;
    const chunkSize = message.content.length > 900 ? 6 : 3;

    await new Promise(function (resolve) {
      function tick() {
        index = Math.min(message.content.length, index + chunkSize);
        bubble.innerHTML = renderMarkdown(message.content.slice(0, index));
        scrollToBottom();

        if (index < message.content.length) {
          window.setTimeout(tick, 14);
        } else {
          resolve();
        }
      }

      tick();
    });
  }

  function renderMessages() {
    dom.messages.replaceChildren();
    state.messages.forEach(function (message) {
      dom.messages.appendChild(createMessageElement(message));
    });
    scrollToBottom();
  }

  function createMessageElement(message) {
    const fragment = dom.template.content.cloneNode(true);
    const article = fragment.querySelector(".message");
    const bubble = fragment.querySelector(".bubble");
    const time = fragment.querySelector("time");
    const copyButton = fragment.querySelector(".copy-button");

    article.classList.add(message.role === "user" ? "user" : "assistant");
    bubble.innerHTML = renderMarkdown(message.content);
    time.dateTime = message.createdAt;
    time.textContent = formatTime(message.createdAt);
    copyButton.addEventListener("click", function () {
      copyMessage(message.content, copyButton);
    });

    return article;
  }

  function renderMarkdown(markdown) {
    const codeBlocks = [];
    let html = escapeHtml(markdown || "").replace(/```([\w.+-]*)\n?([\s\S]*?)```/g, function (_match, lang, code) {
      const token = "%%CODE_BLOCK_" + codeBlocks.length + "%%";
      codeBlocks.push({
        token,
        html: '<pre><code data-language="' + escapeAttribute(lang || "text") + '">' + code.trim() + "</code></pre>"
      });
      return token;
    });

    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_match, label, url) {
      return '<a href="' + escapeAttribute(url) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });

    html = renderLists(html);
    html = html
      .split(/\n{2,}/)
      .map(function (block) {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("%%CODE_BLOCK_")) {
          return trimmed;
        }
        if (trimmed.startsWith("<pre>") || trimmed.startsWith("<ul>") || trimmed.startsWith("<ol>")) {
          return trimmed;
        }
        return "<p>" + trimmed.replace(/\n/g, "<br>") + "</p>";
      })
      .join("");

    codeBlocks.forEach(function (block) {
      html = html.replace(block.token, block.html);
    });

    return html;
  }

  function renderLists(html) {
    const lines = html.split("\n");
    const output = [];
    let listType = null;

    lines.forEach(function (line) {
      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);

      if (unordered || ordered) {
        const nextType = unordered ? "ul" : "ol";
        if (listType !== nextType) {
          if (listType) output.push("</" + listType + ">");
          output.push("<" + nextType + ">");
          listType = nextType;
        }
        output.push("<li>" + (unordered ? unordered[1] : ordered[1]) + "</li>");
        return;
      }

      if (listType) {
        output.push("</" + listType + ">");
        listType = null;
      }
      output.push(line);
    });

    if (listType) output.push("</" + listType + ">");
    return output.join("\n");
  }

  function sanitizeInput(value) {
    return value
      .replace(/\r\n/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .slice(0, CONFIG.MAX_INPUT_LENGTH)
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return String(value).replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function copyMessage(content, button) {
    try {
      await navigator.clipboard.writeText(content);
      const previous = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(function () {
        button.textContent = previous;
      }, 1200);
    } catch (_error) {
      setStatus("Browser tidak mengizinkan copy otomatis.", true);
    }
  }

  function clearChat() {
    if (state.isSending) return;

    state.messages = [{
      role: "assistant",
      content: "Chat sudah dibersihkan. Mulai percakapan baru kapan saja.",
      createdAt: new Date().toISOString()
    }];
    persistMessages();
    setStatus("");
    renderMessages();
  }

  function toggleSettings() {
    const nextHidden = !dom.settingsPanel.hidden;
    dom.settingsPanel.hidden = nextHidden;
    dom.settingsToggle.setAttribute("aria-expanded", String(!nextHidden));
  }

  function saveSettingsFromInputs() {
    state.settings.endpoint = dom.endpointInput.value.trim();
    state.settings.systemPrompt = sanitizeSetting(dom.systemPrompt.value, CONFIG.DEFAULT_SYSTEM_PROMPT, 2000);
    state.settings.temperature = Number(dom.temperatureInput.value);
    dom.temperatureValue.textContent = state.settings.temperature.toFixed(1);
    persistSettings();
  }

  function sanitizeSetting(value, fallback, maxLength) {
    const clean = String(value || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .slice(0, maxLength)
      .trim();
    return clean || fallback;
  }

  function syncSettingsInputs() {
    dom.endpointInput.value = state.settings.endpoint || "";
    dom.systemPrompt.value = state.settings.systemPrompt;
    dom.temperatureInput.value = String(state.settings.temperature);
    dom.temperatureValue.textContent = Number(state.settings.temperature).toFixed(1);
  }

  function loadState() {
    try {
      const storedMessages = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.messages) || "[]");
      if (Array.isArray(storedMessages)) {
        state.messages = storedMessages
          .filter(function (message) {
            return message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
          })
          .slice(-80)
          .map(function (message) {
            return {
              role: message.role,
              content: message.content,
              createdAt: message.createdAt || new Date().toISOString()
            };
          });
      }

      const storedSettings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.settings) || "{}");
      if (storedSettings && typeof storedSettings === "object") {
        state.settings.endpoint = typeof storedSettings.endpoint === "string" ? storedSettings.endpoint : CONFIG.API_URL;
        state.settings.systemPrompt = sanitizeSetting(storedSettings.systemPrompt, CONFIG.DEFAULT_SYSTEM_PROMPT, 2000);
        state.settings.temperature = clampTemperature(storedSettings.temperature);
      }
    } catch (_error) {
      state.messages = [];
    }
  }

  function persistMessages() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.messages, JSON.stringify(state.messages.slice(-80)));
    } catch (_error) {
      setStatus("Riwayat chat tidak bisa disimpan di browser ini.", true);
    }
  }

  function persistSettings() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.settings, JSON.stringify(state.settings));
    } catch (_error) {
      setStatus("Settings tidak bisa disimpan di browser ini.", true);
    }
  }

  function clampTemperature(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return CONFIG.DEFAULT_TEMPERATURE;
    return Math.min(2, Math.max(0, number));
  }

  function getEndpoint() {
    const endpoint = (state.settings.endpoint || CONFIG.API_URL || "").trim();
    if (!endpoint || endpoint.includes("your-worker")) return "";
    return endpoint;
  }

  function setSending(isSending) {
    state.isSending = isSending;
    dom.sendButton.disabled = isSending;
    dom.input.disabled = isSending;
    updateSendState();
  }

  function updateSendState() {
    dom.sendButton.disabled = state.isSending || sanitizeInput(dom.input.value).length === 0;
  }

  function setStatus(message, isError) {
    dom.statusLine.textContent = message || "";
    dom.statusLine.classList.toggle("error", Boolean(isError));
  }

  function resizeTextarea() {
    dom.input.style.height = "auto";
    dom.input.style.height = Math.min(dom.input.scrollHeight, 190) + "px";
  }

  function scrollToBottom() {
    window.requestAnimationFrame(function () {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }

  function removeMessageElement(element) {
    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
})();
