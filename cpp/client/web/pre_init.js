const browserUnsupportedText = "Your browser is not supported. Please use a modern browser like Chrome, Firefox, or Edge.";
const serverBlacklistedText = "This server has been blacklisted.";
const infoElement = document.getElementById("loadingScreen");
function displayUnsupportedText() {
    Module.canvas.style.display = "none";
    infoElement.textContent = browserUnsupportedText;
}
if (!window.WebAssembly) {
    displayUnsupportedText();
}
function displayServerBlacklistedText() {
    Module.canvas.style.display = "none";
    infoElement.textContent = serverBlacklistedText;
    infoElement.style.display = "block";
    infoElement.style.zIndex = 2147483647;
    infoElement.style.color = "#f00";
}
Module.displayServerBlacklistedText = displayServerBlacklistedText;
Module.displayUnsupportedText = displayUnsupportedText;