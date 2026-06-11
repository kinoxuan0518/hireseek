tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var options=doc.querySelectorAll('.option'); var found=''; for(var i=0;i<options.length;i++) { var t=options[i].innerText.trim(); if(t=='在校/应届'||t.indexOf('在校')>=0) { options[i].click(); found='clicked_在校/应届'; break; } } String(found || 'not_found')"
	return resultText
end tell