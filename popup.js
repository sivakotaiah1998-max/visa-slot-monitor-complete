// ====================================
// POPUP SCRIPT - MULTI-LOCATION MONITOR
// ====================================

const LOCATIONS = {
  "HYDERABAD": "Hyderabad",
  "CHENNAI": "Chennai",
  "KOLKATA": "Kolkata",
  "MUMBAI": "Mumbai",
  "DELHI": "Delhi"
};

let lastCheckTime = null;
let alertSound = null;

// DOM Elements
const locationSelect = document.getElementById("locationSelect");
const monitorAllCheckbox = document.getElementById("monitorAll");
const visaTypeSelect = document.getElementById("visaType");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const checkButton = document.getElementById("checkButton");
const resultsDiv = document.getElementById("results");
const slotInfoDiv = document.getElementById("slotInfo");
const multiLocationDiv = document.getElementById("multiLocationResults");
const locationSlotsContainer = document.getElementById("locationSlotsContainer");
const noResultsDiv = document.getElementById("noResults");
const errorDiv = document.getElementById("error");
const loadingDiv = document.getElementById("loading");
const lastCheckedSpan = document.getElementById("lastChecked");
const enableSoundCheckbox = document.getElementById("enableSound");
const enableNotificationCheckbox = document.getElementById("enableNotification");

// Initialize
window.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  setTodayAsDefault();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  monitorAllCheckbox.addEventListener("change", () => {
    if (monitorAllCheckbox.checked) {
      locationSelect.value = "";
      locationSelect.disabled = true;
    } else {
      locationSelect.disabled = false;
    }
    saveSettings();
  });
}

// Set today's date as default
function setTodayAsDefault() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  startDateInput.value = `${year}-${month}-${day}`;

  // Set end date to 60 days from now
  const endDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const endYear = endDate.getFullYear();
  const endMonth = String(endDate.getMonth() + 1).padStart(2, "0");
  const endDay = String(endDate.getDate()).padStart(2, "0");
  endDateInput.value = `${endYear}-${endMonth}-${endDay}`;
}

// Load saved settings
function loadSettings() {
  chrome.storage.local.get(
    ["location", "monitorAll", "visaType", "startDate", "endDate", "enableSound", "enableNotification"],
    (result) => {
      if (result.monitorAll !== undefined) {
        monitorAllCheckbox.checked = result.monitorAll;
        locationSelect.disabled = result.monitorAll;
      }
      if (result.location) locationSelect.value = result.location;
      if (result.visaType) visaTypeSelect.value = result.visaType;
      if (result.startDate) startDateInput.value = result.startDate;
      if (result.endDate) endDateInput.value = result.endDate;
      if (result.enableSound !== undefined) enableSoundCheckbox.checked = result.enableSound;
      if (result.enableNotification !== undefined) enableNotificationCheckbox.checked = result.enableNotification;
    }
  );
}

// Save settings on change
function saveSettings() {
  chrome.storage.local.set({
    location: locationSelect.value,
    monitorAll: monitorAllCheckbox.checked,
    visaType: visaTypeSelect.value,
    startDate: startDateInput.value,
    endDate: endDateInput.value,
    enableSound: enableSoundCheckbox.checked,
    enableNotification: enableNotificationCheckbox.checked
  });
}

[locationSelect, visaTypeSelect, startDateInput, endDateInput, enableSoundCheckbox, enableNotificationCheckbox].forEach(
  (element) => {
    element.addEventListener("change", saveSettings);
  }
);

// Check Slots Button
checkButton.addEventListener("click", () => {
  const isMonitoringAll = monitorAllCheckbox.checked;
  const location = locationSelect.value;
  const visaType = visaTypeSelect.value;
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;

  // Validation
  if (!isMonitoringAll && !location) {
    showError("Please select a location or enable 'Monitor All Locations'");
    return;
  }
  if (!visaType) {
    showError("Please select a visa type");
    return;
  }
  if (!startDate || !endDate) {
    showError("Please select date range");
    return;
  }
  if (new Date(startDate) > new Date(endDate)) {
    showError("Start date must be before end date");
    return;
  }

  // Show loading
  hideAll();
  loadingDiv.style.display = "block";
  checkButton.disabled = true;

  // Check slots
  setTimeout(() => {
    if (isMonitoringAll) {
      checkAllLocations(visaType, startDate, endDate);
    } else {
      checkSingleLocation(location, visaType, startDate, endDate);
    }
  }, 500);
});

// Check slots for a single location
function checkSingleLocation(location, visaType, startDate, endDate) {
  chrome.runtime.sendMessage(
    {
      action: "checkSlots",
      location: location,
      visaType: visaType,
      dateRange: { start: startDate, end: endDate }
    },
    (response) => {
      loadingDiv.style.display = "none";
      checkButton.disabled = false;
      lastCheckTime = new Date();
      updateLastChecked();

      if (response.success) {
        displaySingleLocationResults(response.data, location, startDate, endDate);
      } else {
        showError(response.error || "Failed to check slots");
      }
    }
  );
}

// Check slots for ALL locations
function checkAllLocations(visaType, startDate, endDate) {
  const locationKeys = Object.keys(LOCATIONS);
  let completedChecks = 0;
  const allResults = {};

  locationKeys.forEach((locKey) => {
    chrome.runtime.sendMessage(
      {
        action: "checkSlots",
        location: locKey,
        visaType: visaType,
        dateRange: { start: startDate, end: endDate }
      },
      (response) => {
        completedChecks++;
        if (response.success) {
          allResults[locKey] = response.data;
        }

        // When all locations are checked
        if (completedChecks === locationKeys.length) {
          loadingDiv.style.display = "none";
          checkButton.disabled = false;
          lastCheckTime = new Date();
          updateLastChecked();
          displayMultiLocationResults(allResults, startDate, endDate);
        }
      }
    );
  });
}

// Display results for single location
function displaySingleLocationResults(data, location, startDate, endDate) {
  hideAll();

  if (!data.totalSlots || data.totalSlots === 0) {
    noResultsDiv.style.display = "block";
    return;
  }

  // Show results
  resultsDiv.style.display = "block";
  slotInfoDiv.innerHTML = "";

  // Add location info
  const locationInfo = document.createElement("div");
  locationInfo.className = "slot-item";
  locationInfo.innerHTML = `
    <strong>📍 Location:</strong> ${LOCATIONS[location]}
  `;
  slotInfoDiv.appendChild(locationInfo);

  // Add date range info
  const dateInfo = document.createElement("div");
  dateInfo.className = "slot-item";
  dateInfo.innerHTML = `
    <strong>📅 Date Range:</strong> ${startDate} to ${endDate}
  `;
  slotInfoDiv.appendChild(dateInfo);

  // Add individual slot info
  if (data.slots && data.slots.length > 0) {
    data.slots.forEach((slot) => {
      const slotItem = document.createElement("div");
      slotItem.className = "slot-item";
      slotItem.innerHTML = `
        <span class="slot-date">📌 ${slot.date}</span>
        <span class="slot-count">🔑 ${slot.available} slots</span>
      `;
      slotInfoDiv.appendChild(slotItem);
    });
  }

  // Add total slots
  const totalDiv = document.createElement("div");
  totalDiv.className = "total-slots";
  totalDiv.innerHTML = `
    ✅ TOTAL AVAILABLE SLOTS: <strong>${data.totalSlots}</strong>
  `;
  slotInfoDiv.appendChild(totalDiv);

  // Play alerts
  triggerAlerts(LOCATIONS[location], data.totalSlots);
}

// Display results for ALL locations
function displayMultiLocationResults(allResults, startDate, endDate) {
  hideAll();

  let totalSlotsAcrossAll = 0;
  let locationsWithSlots = [];

  // Calculate totals
  Object.keys(allResults).forEach((locKey) => {
    const data = allResults[locKey];
    if (data.totalSlots > 0) {
      totalSlotsAcrossAll += data.totalSlots;
      locationsWithSlots.push({ location: locKey, data: data });
    }
  });

  if (totalSlotsAcrossAll === 0) {
    noResultsDiv.style.display = "block";
    return;
  }

  // Show multi-location results
  multiLocationDiv.style.display = "block";
  locationSlotsContainer.innerHTML = "";

  // Sort by number of slots (descending)
  locationsWithSlots.sort((a, b) => b.data.totalSlots - a.data.totalSlots);

  // Display each location with slots
  locationsWithSlots.forEach(({ location: locKey, data }) => {
    const card = document.createElement("div");
    card.className = "location-card";

    const header = document.createElement("div");
    header.className = "location-header";
    header.innerHTML = `
      <span class="location-name">📍 ${LOCATIONS[locKey]}</span>
      <span class="location-slot-count">🔑 ${data.totalSlots} slots</span>
    `;
    card.appendChild(header);

    const datesDiv = document.createElement("div");
    datesDiv.className = "location-dates";

    if (data.slots && data.slots.length > 0) {
      data.slots.forEach((slot) => {
        const dateItem = document.createElement("div");
        dateItem.className = "date-item";
        dateItem.innerHTML = `
          <span class="date-name">📌 ${slot.date}</span>
          <span class="date-available">${slot.available} available</span>
        `;
        datesDiv.appendChild(dateItem);
      });
    }

    card.appendChild(datesDiv);
    locationSlotsContainer.appendChild(card);
  });

  // Add summary at top
  const summaryDiv = document.createElement("div");
  summaryDiv.className = "total-slots";
  summaryDiv.innerHTML = `
    🎉 TOTAL SLOTS ACROSS ALL LOCATIONS: <strong>${totalSlotsAcrossAll}</strong>
  `;
  locationSlotsContainer.insertBefore(summaryDiv, locationSlotsContainer.firstChild);

  // Play alerts with all location names
  triggerMultiLocationAlerts(locationsWithSlots, totalSlotsAcrossAll);
}

// Trigger alerts
function triggerAlerts(locationName, totalSlots) {
  // Play sound if enabled
  if (enableSoundCheckbox.checked) {
    playAlertSound(3); // 3 beeps
  }

  // Show notification if enabled
  if (enableNotificationCheckbox.checked) {
    showDesktopNotification(locationName, totalSlots);
  }
}

// Trigger alerts for multi-location
function triggerMultiLocationAlerts(locationsWithSlots, totalSlots) {
  const locationNames = locationsWithSlots.map((l) => LOCATIONS[l.location]).join(", ");

  // Play sound if enabled
  if (enableSoundCheckbox.checked) {
    playAlertSound(5); // 5 beeps for multi-location
  }

  // Show notification if enabled
  if (enableNotificationCheckbox.checked) {
    showDesktopNotificationMultiLocation(locationNames, totalSlots);
  }
}

// Play alert sound with customizable beeps
function playAlertSound(numberOfBeeps = 3) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Play multiple beeps
    for (let i = 0; i < numberOfBeeps; i++) {
      setTimeout(() => {
        oscillator.frequency.value = 800 + i * 100; // Increase frequency for each beep
        oscillator.type = "sine";
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
      }, i * 300);
    }
  } catch (e) {
    console.warn("Could not play sound:", e);
  }
}

// Show desktop notification for single location
function showDesktopNotification(location, totalSlots) {
  const message = `${totalSlots} slot(s) found in ${location}! Check the extension for details.`;

  chrome.notifications.create({
    type: "basic",
    iconUrl: "images/icon-128.png",
    title: "🎉 Visa Slots Available!",
    message: message,
    priority: 2
  });
}

// Show desktop notification for multiple locations
function showDesktopNotificationMultiLocation(locations, totalSlots) {
  const message = `${totalSlots} total slots found in: ${locations}`;

  chrome.notifications.create({
    type: "basic",
    iconUrl: "images/icon-128.png",
    title: "🎉 Visa Slots in Multiple Locations!",
    message: message,
    priority: 2
  });
}

// Show error
function showError(message) {
  hideAll();
  errorDiv.style.display = "block";
  errorDiv.textContent = "❌ " + message;
}

// Hide all sections
function hideAll() {
  resultsDiv.style.display = "none";
  multiLocationDiv.style.display = "none";
  noResultsDiv.style.display = "none";
  errorDiv.style.display = "none";
  loadingDiv.style.display = "none";
}

// Update last checked time
function updateLastChecked() {
  if (lastCheckTime) {
    lastCheckedSpan.textContent = lastCheckTime.toLocaleTimeString();
  }
}
