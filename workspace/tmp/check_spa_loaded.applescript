tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "String(document.body.innerHTML.length+','+document.querySelector('.menu-recommend')!==null)"
	return resultText
end tell