document.addEventListener("DOMContentLoaded", () => {
  // --- internal scheduler to prevent old timers firing after scene changes ---
  const app = {
    token: 0,
    timeouts: new Set(),
    signatureIdleId: null,
    typedStarted: false,
    memoriesRunning: false,
    currentScene: "scene-intro",
    cameraStream: null,
    boothInit: false,
    boothFrozen: false,
  };

  // ---- Typing sound (simple synth ticks, no external file) ----
  const typingSound = (() => {
    let ctx = null;
    let tickId = null;
    const tickMs = 70;

    function ensureContext() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function playTick() {
      const audio = ensureContext();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "square";
      osc.frequency.value = 750 + Math.random() * 120;
      gain.gain.setValueAtTime(0, audio.currentTime);
      gain.gain.linearRampToValueAtTime(0.06, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.06);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.07);
    }

    function start() {
      if (tickId) return;
      playTick();
      tickId = window.setInterval(playTick, tickMs);
    }

    function stop() {
      if (!tickId) return;
      window.clearInterval(tickId);
      tickId = null;
    }

    return { start, stop };
  })();

  // Unlock audio on first user interaction (autoplay policies).
  window.addEventListener("pointerdown", () => {
    typingSound.start();
    typingSound.stop();
  }, { once: true });

  function setAppTimeout(fn, ms) {
    const myToken = app.token;
    const id = window.setTimeout(() => {
      app.timeouts.delete(id);
      if (app.token !== myToken) return;
      fn();
    }, ms);
    app.timeouts.add(id);
    return id;
  }

  function clearAllTimers() {
    for (const id of app.timeouts) window.clearTimeout(id);
    app.timeouts.clear();
    if (app.signatureIdleId) {
      window.clearTimeout(app.signatureIdleId);
      app.signatureIdleId = null;
    }
  }

  function go(sceneId) {
    app.token++;
    clearAllTimers();
    if (app.currentScene === "scene-intro" && sceneId !== "scene-intro") {
      typingSound.stop();
    }
    if (app.currentScene === "scene-photobooth" && sceneId !== "scene-photobooth") {
      stopPhotoBooth();
    }
    if (app.currentScene === "scene-video" && sceneId !== "scene-video") {
      const video = document.getElementById("surpriseVideo");
      const audioBtn = document.getElementById("mainAudioBtn");
      if (video && video.tagName === "VIDEO") {
        video.pause();
        video.muted = true;
      }
      if (audioBtn) audioBtn.textContent = "🔇";
    }
    app.currentScene = sceneId;
    document.body.classList.toggle("photobooth-scroll", sceneId === "scene-photobooth");
    const skipBtn = document.getElementById("globalSkipBtn");
    if (skipBtn) {
      skipBtn.style.display = sceneId === "scene-photobooth" ? "none" : "inline-flex";
    }

    document.querySelectorAll(".scene").forEach(s => s.classList.remove("active"));
    const el = document.getElementById(sceneId);
    if (!el) return;
    el.classList.add("active");

    if (sceneId === "scene-intro") startTyping();
    if (sceneId === "scene-memories") playMemoriesCamera(true);
    if (sceneId === "scene-letter") initLetterScene();
    if (sceneId === "scene-video") initVideoScene();
    if (sceneId === "scene-map") initMapScene();
    if (sceneId === "scene-photobooth") initPhotoBooth();
    if (sceneId === "scene-birthday") initBirthdayScene();
  }

  // ---------------- INTRO TYPING ----------------
  function startTyping() {
    if (app.typedStarted) return;
    app.typedStarted = true;

    new Typed("#typed", {
      strings: [
        "Hey Love ❤️",
        "I made something special for you…",
        "To the most beautiful gatudi in the whole world 💖"
      ],
      typeSpeed: 50,
      showCursor: false,
      onBegin: () => {
        typingSound.start();
      },
      onComplete: () => {
        typingSound.stop();
        const box = document.getElementById("signatureBox");
        if (box) box.style.display = "flex";
        initSignature();
      }
    });
  }

  // ---------------- SIGNATURE PAD ----------------
  function initSignature() {
    const canvas = document.getElementById("signaturePad");
    const clearBtn = document.getElementById("clearSign");
    if (!canvas || !clearBtn) return;

    const ctx = canvas.getContext("2d");
    let drawing = false;
    let hasDrawn = false;

    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const p = (e.touches && e.touches[0]) ? e.touches[0] : e;
      return { x: p.clientX - rect.left, y: p.clientY - rect.top };
    }

    function armIdle() {
      if (app.signatureIdleId) window.clearTimeout(app.signatureIdleId);
      app.signatureIdleId = window.setTimeout(() => {
        if (app.currentScene !== "scene-intro") return;
        app.signatureIdleId = null;
        if (hasDrawn) triggerSigned();
      }, 2800);
    }

    function start(e) {
      drawing = true;
      hasDrawn = true;
      if (app.signatureIdleId) window.clearTimeout(app.signatureIdleId);
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function draw(e) {
      if (!drawing) return;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      armIdle();
    }
    function stop() {
      drawing = false;
      armIdle();
    }

    canvas.onmousedown = start;
    canvas.onmousemove = draw;
    window.onmouseup = stop;

    canvas.ontouchstart = start;
    canvas.ontouchmove = draw;
    canvas.ontouchend = stop;

    clearBtn.onclick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
      if (app.signatureIdleId) window.clearTimeout(app.signatureIdleId);
      app.signatureIdleId = null;
    };
  }

  function triggerSigned() {
    if (app.currentScene !== "scene-intro") return;
    const overlay = document.getElementById("rainbowOverlay");
    if (!overlay) return;

    overlay.classList.add("active");
    setAppTimeout(() => overlay.classList.add("intense"), 1200);

    setAppTimeout(() => {
      overlay.classList.remove("active", "intense");
      go("scene-memories");
    }, 2800);
  }

  // ---------------- MEMORIES CAMERA ----------------
  function playMemoriesCamera(reset = false) {
    const world = document.getElementById("memoriesWorld");
    const btn = document.getElementById("beforeYouGoBtn");
    if (!world || !btn) return;

    if (reset) {
      world.style.transform = "translateX(0vw)";
      btn.classList.remove("show");
      app.memoriesRunning = false;
    }
    if (app.memoriesRunning) return;
    app.memoriesRunning = true;

    let col = 0;
    const totalCols = document.querySelectorAll(".memory-col").length;

    function move() {
      world.style.transform = `translateX(-${col * 100}vw)`;
      col++;
      if (col < totalCols) setAppTimeout(move, 3200);
      else setAppTimeout(() => btn.classList.add("show"), 1200);
    }

    setAppTimeout(move, 900);
  }

  const beforeBtn = document.getElementById("beforeYouGoBtn");
  if (beforeBtn) beforeBtn.onclick = () => go("scene-letter");

  // ---------------- LETTER SCENE ----------------
  function initLetterScene() {
    const env = document.getElementById("envelope");
    const flap = document.getElementById("flapBtn");
    const tip = document.getElementById("flapTip");
    const slot = document.getElementById("letterSlot");
    const letter = document.getElementById("letterCard");
    const hint = document.getElementById("letterHint");
    const magic = document.getElementById("magicText");
    const stamp = document.querySelector(".letter-stamp");

    if (!env || !flap || !slot || !letter || !magic) return;

    // Reset every time we enter letter scene
    env.classList.remove("flap-open", "drop-down");
    slot.classList.remove("expanded");
    letter.classList.remove("full-open");
    magic.innerHTML = "";
    if (tip) tip.classList.add("show");
    if (hint) hint.textContent = "Drag the flap ✨";
    document.body.classList.remove("letter-open");
    const gifBtn = document.getElementById("gifNextBtn");
    if (gifBtn) gifBtn.classList.remove("show");
    if (stamp) {
      stamp.classList.remove("show");
      setAppTimeout(() => stamp.classList.add("show"), 3000);
    }

    let flapOpened = false;
    let pulled = false;

    // ---------- FLAP OPEN ----------
    function openFlap() {
      if (flapOpened) return;
      flapOpened = true;

      env.classList.add("flap-open");
      if (tip) tip.classList.remove("show");
      if (hint) hint.textContent = "Now drag the letter 💌";

      // Put the peek message (simple + reliable)
      magic.innerHTML = `
      <div class="peek-cover">
        READ THIS CUTIEPIE
        <small>(drag the letter up 💌)</small>
      </div>
    `;

      // allow letter interactions now
      slot.style.pointerEvents = "auto";
      letter.style.pointerEvents = "auto";
    }

    // Drag flap up OR click flap
    let flapStartY = 0;
    let flapDragging = false;

    flap.onpointerdown = (e) => {
      if (flapOpened) return;
      flapDragging = true;
      flapStartY = e.clientY;
      flap.setPointerCapture(e.pointerId);
    };

    flap.onpointermove = (e) => {
      if (!flapDragging || flapOpened) return;
      const dy = flapStartY - e.clientY;
      if (dy > 35) openFlap();
    };

    flap.onpointerup = () => { flapDragging = false; };
    flap.onclick = () => openFlap();

    // ---------- PULL LETTER ----------
    function pullLetter() {
      if (pulled || !flapOpened) return;
      pulled = true;

      // Clear peek message before real magic reveal
      magic.innerHTML = "";

      // Expand slot full screen (no reparenting = no disappearing)
      slot.classList.add("expanded");
      letter.classList.add("full-open");
      document.body.classList.add("letter-open");

      // Keep envelope in place; drop-down on a transformed parent causes the
      // fixed fullscreen letter to move off-screen in Chrome/Edge.

      // Start magic text after fullscreen is stable
      setTimeout(() => startMagicText(), 750);

      if (hint) hint.textContent = "✨";
    }

    // Drag letter up OR click (listen on slot so the peek area always works)
    let letterStartY = 0;
    let letterDragging = false;

    const attachPullHandlers = (target, threshold) => {
      target.onpointerdown = (e) => {
        if (!flapOpened || pulled) return;
        letterDragging = true;
        letterStartY = e.clientY;
        target.setPointerCapture(e.pointerId);
      };

      target.onpointermove = (e) => {
        if (!letterDragging || pulled) return;
        const dy = letterStartY - e.clientY;
        if (dy > threshold) pullLetter();
      };

      target.onpointerup = () => { letterDragging = false; };
      target.onclick = () => pullLetter();
    };

    attachPullHandlers(slot, 70);
    attachPullHandlers(letter, 90);
  }


  function startMagicText() {
    const container = document.getElementById("magicText");
    const stamp = document.querySelector(".letter-stamp");
    if (!container) return;

    const text = `
I don’t always say this out loud,
but you are my favorite part of every day.
You make life softer, warmer,
and infinitely more beautiful.
From the very start of our Friendship 
I felt a connection different than others the sync felt so nice
for the first time in my life i was trying hard and finding reasons to see you 
or talk with you from being scared to keeping my head on your shoulder to the 
last cheese bite at prithvi those were the moments that felt once i a lifetime
and that gave assurity of the sync and bond we have, Even on the bad days when i talk 
with you or see you im happy, i dont have more words to express how i feel about you
i just pray to god that he keeps you happy all the time thats all i want because the
bond i brag about is not just for saying, You being sad makes me sad we gotta keep the vibes going 
LOVE YOU - your munchkin 
  `.trim();

    container.innerHTML = "";

    const words = text.split(/\s+/);
    words.forEach((word, i) => {
      const span = document.createElement("span");
      span.className = "magic-word";
      span.style.animationDelay = `${i * 0.11}s`;
      span.textContent = word + " ";
      container.appendChild(span);
    });

    // Show GIF button after the final word finishes its reveal
    const gifBtn = document.getElementById("gifNextBtn");
    if (gifBtn) {
      const totalMs = (words.length - 1) * 110 + 800;
      setTimeout(() => gifBtn.classList.add("show"), totalMs);
    }
  }


  // ---------------- START ----------------
  // ======= DEBUG: OPEN ANY SCENE DIRECTLY =======
  const params = new URLSearchParams(window.location.search);
  const sceneParamRaw = (params.get("scene") || "").toLowerCase().trim();

  if (sceneParamRaw) {
    const directId = sceneParamRaw.startsWith("scene-")
      ? sceneParamRaw
      : `scene-${sceneParamRaw}`;
    const target = document.getElementById(directId);
    if (target) {
      go(directId);
    } else {
      go("scene-intro");
    }
  } else {
    go("scene-intro");
  }

  // ---------------- VIDEO SCENE ----------------
  function initVideoScene() {
    const video = document.getElementById("surpriseVideo");
    const seek = document.getElementById("mainSeek");
    const audioBtn = document.getElementById("mainAudioBtn");
    if (!video) return;
    if (video.tagName !== "VIDEO") return;
    if (seek) wireSeekbar(video, seek);
    if (audioBtn) {
      audioBtn.onclick = () => {
        video.muted = !video.muted;
        audioBtn.textContent = video.muted ? "🔇" : "🔊";
      };
    }
    // Try to autoplay; user click should allow play if browser blocks autoplay
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.then(() => {
        // Unmute when autoplay succeeds
        video.muted = false;
        if (audioBtn) audioBtn.textContent = "🔊";
      }).catch(() => {
        if (audioBtn) audioBtn.textContent = "🔇";
      });
    }
  }

  // GIF button transition to video scene
  const gifBtn = document.getElementById("gifNextBtn");
  if (gifBtn) {
    gifBtn.addEventListener("click", () => {
      if (app.currentScene !== "scene-letter") return;
      document.body.classList.remove("letter-open");
      document.body.classList.add("to-video");
      setTimeout(() => {
        document.body.classList.remove("to-video");
        go("scene-video");
      }, 900);
    });
  }

  // Video -> Map
  const toMapBtn = document.getElementById("toMapBtn");
  if (toMapBtn) {
    toMapBtn.addEventListener("click", () => {
      if (app.currentScene !== "scene-video") return;
      document.body.classList.add("to-video");
      setTimeout(() => {
        document.body.classList.remove("to-video");
        go("scene-map");
      }, 900);
    });
  }

  const toBoothBtn = document.getElementById("toBoothBtn");
  if (toBoothBtn) {
    toBoothBtn.addEventListener("click", () => {
      if (app.currentScene !== "scene-map") return;
      go("scene-photobooth");
    });
  }

  const globalSkipBtn = document.getElementById("globalSkipBtn");
  if (globalSkipBtn) {
    const order = [
      "scene-intro",
      "scene-memories",
      "scene-letter",
      "scene-video",
      "scene-map",
      "scene-photobooth",
      "scene-birthday"
    ];
    globalSkipBtn.addEventListener("click", () => {
      if (app.currentScene === "scene-photobooth") return;
      const idx = order.indexOf(app.currentScene);
      const next = order[(idx + 1) % order.length];
      go(next);
    });
  }

  const toBirthdayBtn = document.getElementById("toBirthdayBtn");
  if (toBirthdayBtn) {
    toBirthdayBtn.addEventListener("click", () => {
      if (app.currentScene !== "scene-photobooth") return;
      go("scene-birthday");
    });
  }

  function initBirthdayScene() {
    const qrCta = document.getElementById("birthdayQrCta");
    const qrImg = document.getElementById("birthdayQrImg");
    if (!qrCta) return;
    qrCta.classList.remove("show");
    const configured = (document.body.getAttribute("data-public-ar-url") || "").trim();
    const onLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const arUrl = configured || new URL("ar.html", window.location.href).href;
    qrCta.href = arUrl;
    if (qrImg) {
      if (configured || !onLocalhost) {
        const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=16&data=${encodeURIComponent(arUrl)}`;
        qrImg.src = qrSrc;
      } else {
        // Localhost links are not reachable from another phone via QR scan.
        qrImg.src = "ar-qr.png";
      }
    }
    setAppTimeout(() => qrCta.classList.add("show"), 5000);
  }

  function initMapScene() {
    const map = document.getElementById("mapCanvas");
    const card = document.getElementById("mapCard");
    const title = document.getElementById("mapCardTitle");
    const caption = document.getElementById("mapCardCaption");
    const close = document.getElementById("mapClose");
    const quiz = document.getElementById("mapQuiz");
    const question = document.getElementById("mapQuestion");
    const feedback = document.getElementById("mapFeedback");
    const options = Array.from(document.querySelectorAll(".map-option"));
    const media = document.getElementById("mapMedia");
    const mapVideo = document.getElementById("mapVideo");
    const mapPhoto = document.getElementById("mapPhoto");
    const mapSeek = document.getElementById("mapSeek");
    const audioBtn = document.getElementById("mapAudioBtn");
    if (!map || !card || !title || !caption || !close) return;
    if (!quiz || !question || !feedback || !media || !mapVideo || !mapPhoto || !audioBtn) return;
    if (mapSeek) wireSeekbar(mapVideo, mapSeek);

    const positionCard = (pinEl) => {
      const mapRect = map.getBoundingClientRect();
      const pinRect = pinEl.getBoundingClientRect();

      const pinX = pinRect.left - mapRect.left + pinRect.width / 2;
      const pinY = pinRect.top - mapRect.top + pinRect.height / 2;

      const padding = 16;
      const gap = 14;

      // Ensure card is measurable
      card.style.left = `${pinX}px`;
      card.style.top = `${pinY + gap}px`;
      const cardRect = card.getBoundingClientRect();
      const cardW = cardRect.width;
      const cardH = cardRect.height;

      let left = pinX;
      let top = pinY + gap;

      const maxLeft = mapRect.width - padding - cardW / 2;
      const minLeft = padding + cardW / 2;
      left = Math.min(Math.max(left, minLeft), maxLeft);

      const fitsBelow = (pinY + gap + cardH) <= (mapRect.height - padding);
      const fitsAbove = (pinY - gap - cardH) >= padding;
      if (!fitsBelow && fitsAbove) {
        top = pinY - gap - cardH;
      } else if (!fitsBelow && !fitsAbove) {
        top = mapRect.height - padding - cardH;
      }

      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    };

    map.querySelectorAll(".map-pin").forEach(pin => {
      pin.onclick = () => {
        const correct = (pin.getAttribute("data-correct") || "").toLowerCase();
        title.textContent = pin.getAttribute("data-title") || "";
        caption.textContent = pin.getAttribute("data-caption") || "";
        question.textContent = pin.getAttribute("data-question") || "A sweet question for you";
        options.forEach(btn => {
          const key = btn.getAttribute("data-opt");
          const text = pin.getAttribute(`data-option-${key}`) || "";
          btn.textContent = text;
          btn.classList.remove("correct", "wrong");
          btn.disabled = false;
        });
        feedback.textContent = "";
        quiz.style.display = "block";
        media.classList.remove("active", "show-photo");
        card.classList.remove("expanded");
        mapVideo.pause();
        mapVideo.removeAttribute("src");
        mapVideo.load();
        mapPhoto.removeAttribute("src");
        mapPhoto.alt = "";
        mapVideo.muted = true;
        audioBtn.textContent = "🔇";

        const videoSrc = pin.getAttribute("data-video") || "";

        const onOptionClick = (e) => {
          const choice = (e.currentTarget.getAttribute("data-opt") || "").toLowerCase();
          options.forEach(btn => btn.disabled = true);
          if (choice === correct) {
            e.currentTarget.classList.add("correct");
            feedback.textContent = "Correct! Unlocking your memory...";
            quiz.style.display = "none";
            media.classList.add("active");
            card.classList.add("expanded");
            card.style.left = "";
            card.style.top = "";
            mapVideo.src = videoSrc;
            mapVideo.muted = true;
            const p = mapVideo.play();
            if (p && typeof p.then === "function") {
              p.then(() => {
                mapVideo.muted = false;
                audioBtn.textContent = "🔊";
              }).catch(() => {
                audioBtn.textContent = "🔇";
              });
            }
        mapVideo.onended = null;
          } else {
            e.currentTarget.classList.add("wrong");
            feedback.textContent = "Try again 💞";
            options.forEach(btn => btn.disabled = false);
            e.currentTarget.classList.remove("wrong");
          }
        };

        options.forEach(btn => {
          btn.onclick = onOptionClick;
        });

        audioBtn.onclick = () => {
          mapVideo.muted = !mapVideo.muted;
          audioBtn.textContent = mapVideo.muted ? "🔇" : "🔊";
        };

        card.classList.add("show");
        requestAnimationFrame(() => positionCard(pin));
      };
    });

    close.onclick = () => {
      card.classList.remove("show");
      card.classList.remove("expanded");
      mapVideo.pause();
    };
    map.onclick = (e) => {
      if (!e.target.closest(".map-pin") && !e.target.closest("#mapCard")) {
        card.classList.remove("show");
      }
    };
  }

  // ---------------- PHOTO BOOTH ----------------
  function initPhotoBooth() {
    const video = document.getElementById("boothVideo");
    const canvas = document.getElementById("boothCanvas");
    const screen = document.getElementById("boothScreen");
    const snapBtn = document.getElementById("boothSnapBtn");
    const retakeBtn = document.getElementById("boothRetakeBtn");
    const shutterBtn = document.getElementById("boothShutterBtn");
    const downloadBtn = document.getElementById("boothDownloadBtn");
    const filterImg = document.getElementById("boothFilterImg");
    const stripSlots = Array.from(document.querySelectorAll(".strip-slot img"));
    const errorEl = document.getElementById("boothError");
    if (!video || !canvas || !screen || !snapBtn || !retakeBtn) return;

    const setFrozen = (frozen) => {
      app.boothFrozen = frozen;
      screen.classList.toggle("frozen", frozen);
    };

    const drawContain = (ctx, img, w, h) => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      const scale = Math.min(w / iw, h / ih);
      const sw = iw * scale;
      const sh = ih * scale;
      const dx = (w - sw) / 2;
      const dy = (h - sh) / 2;
      ctx.drawImage(img, dx, dy, sw, sh);
    };

    const updateDownloadState = () => {
      if (!downloadBtn) return;
      const ready = stripSlots.length >= 3 &&
        stripSlots.slice(0, 3).every(img => !!img.getAttribute("src"));
      downloadBtn.disabled = !ready;
      downloadBtn.classList.toggle("ready", ready);
    };

    if (!app.boothInit) {
      app.boothInit = true;

      snapBtn.addEventListener("click", () => {
        if (!video.videoWidth) return;
        const ctx = canvas.getContext("2d");
        const rect = screen.getBoundingClientRect();
        const targetW = Math.max(1, Math.round(rect.width || video.videoWidth));
        const targetH = Math.max(1, Math.round(rect.height || video.videoHeight));
        const targetAspect = targetW / targetH;
        const sourceAspect = video.videoWidth / video.videoHeight;
        let sx = 0;
        let sy = 0;
        let sWidth = video.videoWidth;
        let sHeight = video.videoHeight;
        if (sourceAspect > targetAspect) {
          sWidth = Math.round(video.videoHeight * targetAspect);
          sx = Math.round((video.videoWidth - sWidth) / 2);
        } else {
          sHeight = Math.round(video.videoWidth / targetAspect);
          sy = Math.round((video.videoHeight - sHeight) / 2);
        }
        canvas.width = sWidth;
        canvas.height = sHeight;
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
        if (filterImg && (filterImg.complete || filterImg.naturalWidth)) {
          drawContain(ctx, filterImg, sWidth, sHeight);
        }
        setFrozen(false);

        if (stripSlots.length) {
          for (let i = stripSlots.length - 1; i > 0; i--) {
            stripSlots[i].src = stripSlots[i - 1].src || "";
          }
          stripSlots[0].src = canvas.toDataURL("image/png");
          stripSlots[0].alt = "Booth photo";
          updateDownloadState();
        }
      });

      retakeBtn.addEventListener("click", () => {
        setFrozen(false);
      });

      if (shutterBtn) {
        shutterBtn.addEventListener("click", () => {
          snapBtn.click();
        });
      }

      if (downloadBtn) {
        downloadBtn.addEventListener("click", async () => {
          const sources = stripSlots.slice(0, 3).map(img => img.getAttribute("src")).filter(Boolean);
          if (sources.length < 3) return;
          const images = await Promise.all(sources.map(src => new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = src;
          })));
          const w = images[0].naturalWidth || 600;
          const h = images[0].naturalHeight || 800;
          const out = document.createElement("canvas");
          out.width = w;
          out.height = h * images.length;
          const outCtx = out.getContext("2d");
          outCtx.fillStyle = "#ffffff";
          outCtx.fillRect(0, 0, out.width, out.height);
          images.forEach((img, i) => {
            outCtx.drawImage(img, 0, i * h, w, h);
          });
          const link = document.createElement("a");
          link.download = "photo-strip.png";
          link.href = out.toDataURL("image/png");
          link.click();
        });
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (errorEl) errorEl.textContent = "Camera not supported on this device.";
      return;
    }

    if (!app.cameraStream) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
        .then(stream => {
          app.cameraStream = stream;
          video.srcObject = stream;
          return video.play();
        })
        .then(() => {
          setFrozen(false);
          if (errorEl) errorEl.textContent = "";
        })
        .catch(() => {
          if (errorEl) errorEl.textContent = "Allow camera access to use the photo booth.";
        });
    } else {
      video.srcObject = app.cameraStream;
      video.play().catch(() => {});
    }

    updateDownloadState();
  }

  function stopPhotoBooth() {
    if (app.cameraStream) {
      app.cameraStream.getTracks().forEach(track => track.stop());
      app.cameraStream = null;
    }
    const screen = document.getElementById("boothScreen");
    if (screen) screen.classList.remove("frozen");
    app.boothFrozen = false;
  }

  function wireSeekbar(video, seek) {
    if (!video || !seek) return;
    const setMax = () => {
      if (Number.isFinite(video.duration)) {
        seek.max = video.duration.toString();
      }
    };
    video.addEventListener("loadedmetadata", setMax);
    video.addEventListener("durationchange", setMax);
    video.addEventListener("timeupdate", () => {
      if (!seek.matches(":active")) {
        seek.value = video.currentTime.toString();
      }
    });
    seek.addEventListener("input", () => {
      video.currentTime = parseFloat(seek.value || "0");
    });
    // Quick tap on video toggles play/pause
    video.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
  }
});
