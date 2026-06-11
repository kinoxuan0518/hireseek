tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var opts=doc.querySelectorAll('.option.active'); var texts=''; for(var i=0;i<opts.length;i++){texts=texts+opts[i].innerText.trim()+','} String(texts)"
	return resultText
end tell