tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var btns=doc.querySelectorAll('.btn'); var found='notfound'; for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim()=='确认'){btns[i].click();found='confirmed';break}} String(found)"
	return resultText
end tell