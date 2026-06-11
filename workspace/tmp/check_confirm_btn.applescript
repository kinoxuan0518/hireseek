tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var btns=doc.querySelectorAll('.btn'); var texts=''; for(var i=0;i<btns.length;i++) { texts=texts+btns[i].innerText.trim()+'|'+btns[i].className+'\\n' } String(texts)"
	return resultText
end tell