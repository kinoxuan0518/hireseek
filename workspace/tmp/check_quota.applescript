tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "String(document.body.innerText.indexOf('招聘数据'))"
	return resultText
end tell