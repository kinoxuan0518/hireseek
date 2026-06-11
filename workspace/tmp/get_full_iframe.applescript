tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "String(document.querySelector('iframe').contentDocument.body.innerText)"
	return resultText
end tell