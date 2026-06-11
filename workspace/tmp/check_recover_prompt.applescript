tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; String(doc.body.innerText.indexOf('应用上次')>=0)"
	return resultText
end tell