tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "String(document.querySelector('iframe').contentDocument.body.innerText.indexOf('请先完善')>=0 || document.body.innerText.indexOf('请先完善')>=0 || document.querySelectorAll('.dialog').length)"
	return resultText
end tell