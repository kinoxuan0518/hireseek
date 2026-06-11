tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var text=doc.body.innerText; var idx=text.indexOf('梁昌'); String(text.substring(idx-50, idx+300))"
	return resultText
end tell