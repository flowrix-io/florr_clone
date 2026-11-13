const browserUnsupportedText = "Your browser is not supported. Please use a modern browser like Chrome, Firefox, or Edge.";
const integrityFailureText = "Client integrity check failed.";
const infoElement = document.getElementById("loadingScreen");
function displayUnsupportedText() {
    Module.canvas.style.display = "none";
    infoElement.textContent = browserUnsupportedText;
}
if (!window.WebAssembly) {
    displayUnsupportedText();
}
function reportIntegrityFailure() {
    Module.canvas.style.display = "none";
    infoElement.textContent = integrityFailureText;
    infoElement.style.display = "block";
    infoElement.style.zIndex = 2147483647;
    infoElement.style.color = "#f00";
}
Module.reportIntegrityFailure = reportIntegrityFailure;
Module.displayUnsupportedText = displayUnsupportedText;