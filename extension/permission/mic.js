// Asks for microphone access from a normal tab. Chrome then remembers the
// permission for the extension, and the side panel can use speech input.

document.getElementById('allow').addEventListener('click', async () => {
  const result = document.getElementById('result');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    result.textContent = 'Thank you. You can close this tab and press Speak in Hope.';
  } catch {
    result.textContent = 'The microphone is still blocked. You can allow it from the icon at the right of the address bar, or just type your goal.';
  }
});
