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

// EXAMPLE DATA FOR TESTING - Shows realistic slot availability
const EXAMPLE_DATA = {
  "HYDERABAD": {
    slots: [
      { date: "21/09/2026", available: 3 },
      { date: "22/09/2026", available: 5 },
      { date: "23/09/2026", available: 2 }
    ],
    totalSlots: 10
  },
  "CHENNAI": {
    slots: [
      { date: "21/09/2026", available: 5 },
      { date: "22/09/2026", available: 7 },
      { date: "24/09/2026", available: 4 }
    ],
    totalSlots: 16
  },
  "KOLKATA": {
    slots: [
      { date: "20/09/2026", available: 2 },
      { date: "23/09/2026", available: 3 },
      { date: "25/09/2026", available: 1 }
    ],
    totalSlots: 6
  },
  "MUMBAI": {
    slots: [
      { date: "21/09/2026", available: 4 },
      { date: "22/09/2026", available: 6 },
      { date: "26/09/2026", available: 2 }
    ],
    totalSlots: 12
  },
  "DELHI": {
    slots: [
      { date: "19/09/2026", available: 1 },
      { date: "22/09/2026", available: 8 },
      { date: "24/09/2026", available: 3 }
    ],
    totalSlots: 12
  }
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
    // Check if visa scheduling site is open
    const tabs = await chrome.tabs.query({ url: "https://www.usvisascheduling.com/*" });
    if (!tabs.length) {
      // For DEMO/TESTING: Return example data
      console.log("[VISA MONITOR] Demo Mode - Returning example data for:", location);
      return getExampleData(location);
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
    // Return example data on error (for testing)
    return getExampleData(location);
  }
}

// Get example data for testing
function getExampleData(location) {
  const exampleData = EXAMPLE_DATA[location] || { slots: [], totalSlots: 0 };
  return {
    location: location,
    slots: exampleData.slots,
    totalSlots: exampleData.totalSlots,
    lastChecked: new Date().toLocaleTimeString(),
    isExampleData: true
  };
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
