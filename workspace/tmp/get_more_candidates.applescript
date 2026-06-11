tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var text=doc.body.innerText; var idx=text.indexOf('何应丰原'); String(text.substring(idx, idx+500))"
	return resultText
end tell