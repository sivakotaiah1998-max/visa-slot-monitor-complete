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
    return true;
  }

  if (message.action === "playSound") {
    sendResponse({ status: "Sound triggered" });
  }
});

// Check available slots for a location
async function checkAvailableSlots(location, dateRange) {
  try {
    // Get the active visa scheduling tab
    const tabs = await chrome.tabs.query({ url: "https://www.usvisascheduling.com/*" });
    if (!tabs.length) {
      throw new Error("Visa scheduling site not open. Please open https://www.usvisascheduling.com and select a location first");
    }

    const tab = tabs[0];
    
    // Inject script to extract REAL slot data from the page
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

// Function to run in page context - Extract REAL DATA from website
function extractSlotData(location, dateRange) {
  const slots = [];
  let totalSlots = 0;

  try {
    console.log("[VISA MONITOR] Extracting REAL slots for:", location);

    // Method 1: Extract from calendar UI (jQuery UI Datepicker)
    const calendarRows = document.querySelectorAll("table.ui-datepicker-calendar tbody tr");
    
    if (calendarRows.length > 0) {
      console.log("[VISA MONITOR] Found calendar with rows:", calendarRows.length);
      
      calendarRows.forEach(row => {
        const cells = row.querySelectorAll("td");
        cells.forEach(cell => {
          // Skip disabled dates
          if (cell.classList.contains("ui-state-disabled")) return;
          if (cell.classList.contains("ui-datepicker-unselectable")) return;
          
          const link = cell.querySelector("a");
          if (link) {
            const day = link.textContent.trim();
            const availText = cell.textContent.trim();
            
            // Extract number of available slots
            const availCount = parseInt(availText.replace(/[^0-9]/g, "")) || 0;
            
            if (availCount > 0) {
              slots.push({
                date: day,
                available: availCount
              });
              totalSlots += availCount;
              console.log("[VISA MONITOR] Found REAL slot - Date:", day, "Available:", availCount);
            }
          }
        });
      });
    }

    // Method 2: Try alternate selectors (in case page structure is different)
    if (totalSlots === 0) {
      console.log("[VISA MONITOR] No slots found from primary method, trying alternate...");
      
      // Look for any elements with slot count information
      const allCells = document.querySelectorAll("td a");
      allCells.forEach(link => {
        const text = link.textContent.trim();
        const parent = link.closest("td");
        
        if (parent && !parent.classList.contains("ui-state-disabled")) {
          const content = parent.textContent.trim();
          const match = content.match(/(\d+)/);
          
          if (match) {
            const day = text;
            const count = parseInt(match[1]) || 0;
            
            if (count > 0 && !slots.find(s => s.date === day)) {
              slots.push({
                date: day,
                available: count
              });
              totalSlots += count;
            }
          }
        }
      });
    }

    // Get month and year for reference
    const monthEl = document.querySelector(".ui-datepicker-month");
    const yearEl = document.querySelector(".ui-datepicker-year");
    let currentMonth = "";
    let currentYear = "";
    
    if (monthEl) currentMonth = monthEl.textContent.trim() || monthEl.value;
    if (yearEl) currentYear = yearEl.textContent.trim() || yearEl.value;

    console.log("[VISA MONITOR] Final result - Total REAL slots found:", totalSlots);

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
