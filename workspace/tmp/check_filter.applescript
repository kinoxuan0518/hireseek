tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "String(document.querySelector('.filter-wrap') !== null)"
	return resultText
end tell