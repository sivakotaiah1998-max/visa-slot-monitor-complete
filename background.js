// =====================================
// BACKGROUND SERVICE WORKER
// =====================================

const LOCATIONS = {
  "HYDERABAD": { code: "HYD", city: "Hyderabad" },
  "CHENNAI": { code: "MAA", city: "Chennai" },
  "KOLKATA": { code: "CCU", city: "Kolkata" },
  "MUMBAI": { code: "BOM", city: "Mumbai" },
  "DELHI": { code: "DEL", city: "Delhi" }
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkSlots") {
    checkAvailableSlots(message.location, message.dateRange)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the channel open for async response
  }

  if (message.action === "playSound") {
    // Sound will be played from popup script
    sendResponse({ status: "Sound triggered" });
  }
});

// Check available slots for a location
async function checkAvailableSlots(location, dateRange) {
  try {
    // Get the active visa scheduling tab
    const tabs = await chrome.tabs.query({ url: "https://www.usvisascheduling.com/*" });
    if (!tabs.length) {
      throw new Error("Visa scheduling site not open");
    }

    const tab = tabs[0];
    
    // Inject script to extract slot data from the page
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [location, dateRange],
      func: extractSlotData
    });

    return result[0]?.result || { slots: [], totalSlots: 0 };
  } catch (error) {
    console.error("[VISA MONITOR] Error:", error);
    throw error;
  }
}

// Function to run in page context
function extractSlotData(location, dateRange) {
  const slots = [];
  let totalSlots = 0;

  try {
    // Method 1: Extract from calendar UI
    const calendarRows = document.querySelectorAll("table.ui-datepicker-calendar tbody tr");
    
    if (calendarRows.length > 0) {
      calendarRows.forEach(row => {
        const cells = row.querySelectorAll("td");
        cells.forEach(cell => {
          if (cell.classList.contains("ui-state-disabled")) return;
          if (cell.classList.contains("ui-datepicker-unselectable")) return;
          
          const link = cell.querySelector("a");
          if (link) {
            const day = link.textContent.trim();
            const availText = cell.textContent.trim();
            const availCount = parseInt(availText.replace(/[^0-9]/g, "")) || 0;
            
            if (availCount > 0) {
              slots.push({
                date: day,
                available: availCount
              });
              totalSlots += availCount;
            }
          }
        });
      });
    }

    // Method 2: Try to extract month/year context
    const monthEl = document.querySelector(".ui-datepicker-month");
    const yearEl = document.querySelector(".ui-datepicker-year");
    let currentMonth = "";
    let currentYear = "";
    
    if (monthEl) currentMonth = monthEl.textContent.trim() || monthEl.value;
    if (yearEl) currentYear = yearEl.textContent.trim() || yearEl.value;

    // Method 3: Extract from page text/data if available
    if (totalSlots === 0) {
      const pageText = document.body.innerText;
      const slotsMatch = pageText.match(/(\d+)\s*(?:slot|available|appointment)/i);
      if (slotsMatch) {
        totalSlots = parseInt(slotsMatch[1]) || 0;
      }
    }

  } catch (error) {
    console.warn("[VISA MONITOR] Extraction error:", error);
  }

  return {
    location: location,
    slots: slots,
    totalSlots: totalSlots,
    lastChecked: new Date().toLocaleTimeString()
  };
}

// Keep service worker alive
chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {
  chrome.storage.local.get("vacMonitorActive", () => {});
});
