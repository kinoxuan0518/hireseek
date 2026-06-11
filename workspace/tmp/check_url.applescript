tell application "Google Chrome"
	set resultText to get URL of tab 2 of window 1
	return resultText
end tell