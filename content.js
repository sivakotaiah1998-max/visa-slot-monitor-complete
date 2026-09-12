// =====================================
// CONTENT SCRIPT
// =====================================

// This script runs in the context of usvisascheduling.com
// It helps extract slot data from the page

console.log("[VISA MONITOR] Content script loaded");

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getPageData") {
    const data = extractPageData();
    sendResponse({ success: true, data: data });
  }
});

// Extract data from the current page
function extractPageData() {
  try {
    // Look for calendar data
    const calendarElement = document.querySelector(".ui-datepicker-calendar");
    
    // Look for slot availability indicators
    const slotElements = document.querySelectorAll("[data-slots], [class*='slot'], [class*='available']");
    
    return {
      hasCalendar: !!calendarElement,
      pageTitle: document.title,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[VISA MONITOR] Error extracting page data:", error);
    return { error: error.message };
  }
}
