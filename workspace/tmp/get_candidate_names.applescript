tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var els=doc.querySelectorAll('.name'); var names=''; for(var i=0;i<els.length;i++){names=names+els[i].innerText.trim()+'\\n'} String(names)"
	return resultText
end tell