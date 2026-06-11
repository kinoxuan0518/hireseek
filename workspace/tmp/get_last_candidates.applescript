tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var text=doc.body.innerText; var idx=text.indexOf('杨淞'); String(text.substring(idx, idx+800))"
	return resultText
end tell