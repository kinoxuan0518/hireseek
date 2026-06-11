tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "String(document.querySelectorAll('iframe').length)"
	return resultText
end tell