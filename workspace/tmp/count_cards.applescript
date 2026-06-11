tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var btns=doc.querySelectorAll('.btn.btn-greet'); String(btns.length)"
	return resultText
end tell