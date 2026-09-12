// =====================================
// KEEP SERVICE WORKER ALIVE
// =====================================

chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {
  chrome.storage.local.get("vacBotActive", () => {});
});

// =====================================
// MESSAGES
// =====================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "registerRedirect") startBot();
  if (message.action === "stopBot") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]) chrome.scripting.executeScript({
        target: { tabId: tabs[0].id }, world: "MAIN",
        func: () => {
          window.__VAC_BOT_RUNNING__ = false;
          if (window.__VAC_POLL_ID__) clearInterval(window.__VAC_POLL_ID__);
          if (window.__VAC_MUT_OBS__) window.__VAC_MUT_OBS__.disconnect();
          console.log("[VAC BOT] STOPPED");
        }
      });
    });
    chrome.storage.local.set({ vacBotActive: false });
  }
  if (message.action === "slotFound") {
    console.log("[VAC BOT] Slot found - AUTO SUBMITTING");
  }
  return true;
});

// =====================================
// CLOUDFLARE + AUTO RESTART BOT ON PAGE LOAD
// =====================================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url || !tab.url.includes("usvisascheduling.com")) return;
  if (changeInfo.status !== "complete") return;

  chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: cfHandler });

  const state = await chrome.storage.local.get(["vacBotActive", "desiredDates"]);
  if (!state.vacBotActive || !state.desiredDates?.length) return;

  const validPage = tab.url.includes("usvisascheduling.com") ||
    tab.url.includes("atlasauth.b2clogin.com");

  if (!validPage) return;

  console.log("[VAC BOT] Valid page loaded — reinjecting bot on tab:", tabId);
  try { await reinjectBot(tabId); } catch(e) { console.log("[VAC BOT] Reinject error:", e.message); }
});

function cfHandler() {
  const isCF = document.title.toLowerCase().includes("just a moment") ||
    document.body.innerText.includes("Verify you are human");
  if (!isCF) return;
  const widget = document.querySelector(".cf-turnstile") ||
    document.querySelector("iframe[src*='challenges.cloudflare.com']");
  if (!widget) { setTimeout(cfHandler, 800); return; }
  setTimeout(() => {
    const r = widget.getBoundingClientRect();
    const x = r.left + 28 + Math.random()*10 - 5;
    const y = r.top + r.height/2 + Math.random()*8 - 4;
    ["mouseenter","mouseover","mousedown","mouseup","click"].forEach((t,i) =>
      setTimeout(() => widget.dispatchEvent(new MouseEvent(t,
        { bubbles:true, cancelable:true, clientX:x, clientY:y })), i*40));
  }, 1500 + Math.random()*2000);
}

async function reinjectBot(tabId) {
  const settings = await chrome.storage.local.get(null);
  if (!settings.desiredDates?.length) return;

  await chrome.scripting.executeScript({
    target: { tabId }, world: "ISOLATED",
    func: () => {
      if (window.__VAC_BRIDGE_LISTENER__)
        window.removeEventListener("message", window.__VAC_BRIDGE_LISTENER__);
      window.__VAC_BRIDGE_LISTENER__ = (e) => {
        if (e.source !== window || e.data?.type !== "VAC_SLOT_FOUND") return;
        try { chrome.runtime.sendMessage({ action: "slotFound", matchedDates: e.data.matchedDates || [] }); }
        catch(err) {}
      };
      window.addEventListener("message", window.__VAC_BRIDGE_LISTENER__);
    }
  });

  await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    args: [settings],
    func: injectBotMain
  });
}

// =====================================
// START BOT
// =====================================

async function startBot() {
  let tab;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.url?.includes("usvisascheduling.com")) {
    tab = activeTab;
  } else {
    const visaTabs = await chrome.tabs.query({ url: "https://www.usvisascheduling.com/*" });
    tab = visaTabs.find(t =>
      t.url.includes("/ofc-schedule") || t.url.includes("/schedule/")
    ) || visaTabs[0];
  }
  if (!tab) {
    console.error("[VAC BOT] No usvisascheduling.com tab found — open the visa site first");
    chrome.storage.local.set({ botError: "Open usvisascheduling.com first!" });
    return;
  }
  console.log("[VAC BOT] Using tab:", tab.id, tab.url);
  const settings = await chrome.storage.local.get(null);
  if (!settings.desiredDates?.length) {
    console.error("[VAC BOT] No dates saved!");
    chrome.storage.local.set({ botError: "Save dates first!" });
    return;
  }

  chrome.storage.local.set({ vacBotActive: true });
  console.log("[VAC BOT SW] Starting | dates:", settings.desiredDates.length,
    "| range:", settings.desiredDates[0], "→", settings.desiredDates[settings.desiredDates.length-1]);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: "ISOLATED",
    func: () => {
      if (window.__VAC_BRIDGE_LISTENER__)
        window.removeEventListener("message", window.__VAC_BRIDGE_LISTENER__);
      window.__VAC_BRIDGE_LISTENER__ = (e) => {
        if (e.source !== window || e.data?.type !== "VAC_SLOT_FOUND") return;
        try {
          chrome.runtime.sendMessage({ action: "slotFound", matchedDates: e.data.matchedDates || [] });
        } catch(err) {
          console.warn("[VAC BOT BRIDGE] sendMessage failed:", err.message);
        }
      };
      window.addEventListener("message", window.__VAC_BRIDGE_LISTENER__);
      console.log("[VAC BOT BRIDGE] Active");
    }
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: "MAIN",
    args: [settings],
    func: injectBotMain
  });
}

// =====================================
// MAIN BOT INJECTION - AUTO SUBMIT AT MAX SPEED
// =====================================

function injectBotMain(settings) {
      window.__VAC_BOT_RUNNING__ = false;
      if (window.__VAC_POLL_ID__)  clearInterval(window.__VAC_POLL_ID__);
      if (window.__VAC_MUT_OBS__)  window.__VAC_MUT_OBS__?.disconnect();

      if (window.__VAC_DROP_HANDLER__) {
        document.removeEventListener("change", window.__VAC_DROP_HANDLER__, true);
        window.__VAC_DROP_HANDLER__ = null;
      }

      if (window.__VAC_SLOT_OBSERVER__) {
        window.__VAC_SLOT_OBSERVER__.disconnect();
        window.__VAC_SLOT_OBSERVER__ = null;
      }

      if (window.__VAC_ORIG_OPEN__)  XMLHttpRequest.prototype.open = window.__VAC_ORIG_OPEN__;
      if (window.__VAC_ORIG_SEND__)  XMLHttpRequest.prototype.send = window.__VAC_ORIG_SEND__;
      if (window.__VAC_ORIG_FETCH__) window.fetch = window.__VAC_ORIG_FETCH__;

      const desiredDates = settings.desiredDates || [];
      console.log("[VAC BOT] ▶ STARTED | Range:", desiredDates[0], "→", desiredDates[desiredDates.length-1], "("+desiredDates.length+" days)");

      window.__VAC_BOT_RUNNING__ = true;
      window.__VAC_SENT__        = false;
      window.__VAC_JSON_MATCHED__ = null;

      window.__VAC_ORIG_OPEN__  = XMLHttpRequest.prototype.open;
      window.__VAC_ORIG_SEND__  = XMLHttpRequest.prototype.send;
      window.__VAC_ORIG_FETCH__ = window.fetch;

      XMLHttpRequest.prototype.open = function(m, url, ...r) {
        this.__vUrl__ = url;
        return window.__VAC_ORIG_OPEN__.call(this, m, url, ...r);
      };
      XMLHttpRequest.prototype.send = function(...a) {
        this.addEventListener("loadend", () => {
          if (window.__VAC_BOT_RUNNING__ && this.status === 200 && this.responseText)
            processJSON(this.responseText);
        });
        return window.__VAC_ORIG_SEND__.call(this, ...a);
      };

      window.fetch = async function(input, init) {
        const res = await window.__VAC_ORIG_FETCH__.call(window, input, init);
        if (window.__VAC_BOT_RUNNING__ && res.status === 200) {
          try { processJSON(await res.clone().text()); } catch(e) {}
        }
        return res;
      };

      let __VAC_POLL_BUSY__ = false;

      function fastPollCalendar() {
        if (!window.__VAC_BOT_RUNNING__ || __VAC_POLL_BUSY__) return;
        __VAC_POLL_BUSY__ = true;
        try {
          pollCalendar();
        } catch (e) {
          console.warn("[VAC BOT] Calendar scan error:", e.message);
        } finally {
          __VAC_POLL_BUSY__ = false;
        }
      }

      setTimeout(fastPollCalendar, 300);

      window.__VAC_POLL_ID__ = setInterval(() => {
        if (!window.__VAC_BOT_RUNNING__) {
          clearInterval(window.__VAC_POLL_ID__);
          return;
        }
        fastPollCalendar();
      }, 3000);

      if (window.__VAC_DROP_HANDLER__) {
        document.removeEventListener("change", window.__VAC_DROP_HANDLER__, true);
      }

      window.__VAC_DROP_HANDLER__ = (event) => {
        const select = event.target;
        if (!(select instanceof HTMLSelectElement)) return;
        window.__VAC_SENT__ = false;
        window.__VAC_JSON_MATCHED__ = null;
        console.log("[VAC BOT] Selection changed:", select.options[select.selectedIndex]?.text?.trim() || "");
        setTimeout(() => {
          if (window.__VAC_BOT_RUNNING__) fastPollCalendar();
        }, 150);
      };

      document.addEventListener("change", window.__VAC_DROP_HANDLER__, true);

      function pollCalendar() {
        const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

        function getMonthYear(el) {
          const mEl = el.querySelector(".ui-datepicker-month");
          const yEl = el.querySelector(".ui-datepicker-year");
          if (!mEl || !yEl) return null;
          let m = mEl.tagName === "SELECT" ? parseInt(mEl.value) : (() => { const t = mEl.textContent.trim(); const i = MONTHS.indexOf(t); return i >= 0 ? i : SHORT.indexOf(t); })();
          const y = yEl.tagName === "SELECT" ? parseInt(yEl.value) : parseInt(yEl.textContent.trim());
          if (m < 0 || isNaN(y)) return null;
          return { m, y };
        }

        const visibleDates = [];
        const groups = document.querySelectorAll(".ui-datepicker-group");
        const panels = groups.length > 0 ? Array.from(groups) : [document.querySelector(".ui-datepicker")].filter(Boolean);

        panels.forEach(panel => {
          const my = getMonthYear(panel);
          if (!my) return;
          panel.querySelectorAll("table.ui-datepicker-calendar td").forEach(td => {
            if (td.classList.contains("ui-datepicker-unselectable")) return;
            if (td.classList.contains("ui-state-disabled")) return;
            const a = td.querySelector("a");
            if (!a) return;
            const day = parseInt(a.textContent.trim());
            if (isNaN(day) || day < 1 || day > 31) return;
            visibleDates.push(`${my.y}-${String(my.m + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
          });
        });

        if (!visibleDates.length) return;
        const matched = visibleDates.filter(d => desiredDates.includes(d));
        console.log("[VAC BOT POLL] Visible:", visibleDates.length, "| Matched:", matched.length, matched.length ? "| first: "+matched[0] : "");
        if (matched.length) notify(matched);
      }

      function processJSON(text) {
        if (!text || text.length < 5) return;
        let data; try { data = JSON.parse(text); } catch { return; }
        if (!data) return;
        let list = null;
        for (const k of ["ScheduleDays","scheduleDays","AvailableDates","availableDates","Dates","dates","Days","days","Slots","slots","Results","results","Data","data"]) {
          if (Array.isArray(data[k]) && data[k].length > 0) { list = data[k]; break; }
        }
        if (!list && Array.isArray(data) && data.length > 0) list = data;
        if (!list) return;

        const avail = [];
        list.forEach(item => {
          if (typeof item === "string") { avail.push(item.split("T")[0]); return; }
          if (typeof item !== "object" || !item) return;
          const v = item.Date||item.date||item.DateTime||item.dateTime||item.AvailableDate||item.Day||item.day||item.SlotDate;
          if (v) avail.push(String(v).split("T")[0]);
        });

        const matched = avail.filter(d => desiredDates.includes(d));
        if (matched.length) {
          window.__VAC_JSON_MATCHED__ = matched;
          console.log("[VAC BOT JSON] matched:", matched.length, "| first:", matched[0]);
          notify(matched);
        } else {
          console.log("[VAC BOT JSON] no matches in range", desiredDates[0], "→", desiredDates[desiredDates.length-1]);
        }
      }

      function notify(matched) {
        if (!window.__VAC_BOT_RUNNING__) return;
        if (window.__VAC_SENT__) return;
        if (!matched || !matched.length) return;

        window.__VAC_SENT__ = true;
        const sel = document.querySelector("select");
        const loc = sel ? (sel.options[sel.selectedIndex]?.text?.trim() || "") : "";
        console.log("[VAC BOT] ✅ SLOT FOUND at", loc, "| first:", matched[0]);
        console.log("[VAC BOT] 🚀 AUTO SUBMITTING AT MAXIMUM SPEED!");
        document.title = "✅ SLOT FOUND - AUTO SUBMITTING";

        autoSubmitSlot(matched);

        const all = window.__VAC_JSON_MATCHED__ || matched;
        const firstMonth = all[0].substring(0, 7);
        const forMonth = all.filter(d => d.startsWith(firstMonth));
        window.postMessage({ type: "VAC_SLOT_FOUND", matchedDates: forMonth }, "*");
      }

      function autoSubmitSlot(matchedDates) {
        if (!matchedDates?.length) return;

        const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const sorted = [...matchedDates].sort((a,b) => new Date(a)-new Date(b));
        const targetDate = sorted[0];
        const targetDay = parseInt(targetDate.split("-")[2]);
        const targetMon = parseInt(targetDate.split("-")[1]) - 1;
        const targetYear = parseInt(targetDate.split("-")[0]);

        console.log("[VAC BOT AUTO] 🚀 INSTANT BOOKING:", targetDate);

        function clickDate() {
          const allTds = document.querySelectorAll("table.ui-datepicker-calendar td");
          for (const td of allTds) {
            if (td.classList.contains("ui-datepicker-unselectable")) continue;
            if (td.classList.contains("ui-state-disabled")) continue;
            const a = td.querySelector("a");
            if (!a || parseInt(a.textContent.trim()) !== targetDay) continue;
            const panel = td.closest(".ui-datepicker-group") || td.closest(".ui-datepicker");
            const mEl = panel?.querySelector(".ui-datepicker-month");
            const yEl = panel?.querySelector(".ui-datepicker-year");
            if (mEl && yEl) {
              let m = mEl.tagName==="SELECT" ? parseInt(mEl.value) : (() => { const t=mEl.textContent.trim(); const i=MONTHS.indexOf(t); return i>=0?i:SHORT.indexOf(t); })();
              const y = yEl.tagName==="SELECT" ? parseInt(yEl.value) : parseInt(yEl.textContent.trim());
              if (m !== targetMon || y !== targetYear) continue;
            }
            a.click();
            console.log("[VAC BOT AUTO] ✅ Date clicked:", targetDate);
            return true;
          }
          return false;
        }

        if (!clickDate()) {
          try {
            if (window.$) {
              const dp = $("#datepicker,[id*='datepicker'],[id*='Date']").first();
              if (dp.length) { dp.datepicker("setDate", new Date(targetYear, targetMon, targetDay)); clickDate(); }
            }
          } catch(e) {}
        }

        let done = false;

        function getSubmitButton() {
          return (
            document.querySelector("button[type='submit']:not([disabled])") ||
            document.querySelector("input[type='submit']:not([disabled])") ||
            [...document.querySelectorAll("button,input[type='button']")].find(b => {
              const text = (b.value || b.innerText || "").trim().toLowerCase();
              return text === "submit" && !b.disabled;
            })
          );
        }

        function selectAndSubmit() {
          if (done) return false;

          const rows = document.querySelectorAll("table tbody tr");
          let bestRadio = null;
          let bestAvailable = -1;

          for (const row of rows) {
            const radio = row.querySelector("input[type='radio']:not([disabled])");
            if (!radio) continue;
            const cells = row.querySelectorAll("td");
            const text = cells[2]?.innerText || cells[cells.length - 1]?.innerText || "";
            const available = parseInt(text.replace(/[^0-9]/g, ""), 10) || 0;
            if (available > bestAvailable) {
              bestAvailable = available;
              bestRadio = radio;
            }
          }

          if (!bestRadio) return false;

          try {
            bestRadio.click();
            console.log("[VAC BOT AUTO] ✅ Slot selected");

            const submit = getSubmitButton();
            if (submit) {
              done = true;
              submit.click();
              console.log("[VAC BOT AUTO] ✅ SUBMITTED - BOOKING COMPLETE!");
              return true;
            }
          } catch (e) {
            console.warn("[VAC BOT AUTO] Error:", e.message);
          }
          return false;
        }

        selectAndSubmit();
      }

      console.log("[VAC BOT] ✅ LIVE — AUTO SUBMIT ENABLED AT MAXIMUM SPEED");
}
