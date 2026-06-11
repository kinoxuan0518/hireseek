tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var options=doc.querySelectorAll('.option.active'); var texts=''; for(var i=0;i<options.length;i++){texts=texts+options[i].innerText.trim()+','} String(texts)"
	return resultText
end tell