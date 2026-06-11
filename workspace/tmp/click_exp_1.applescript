tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var options=doc.querySelectorAll('.option'); for(var i=0;i<options.length;i++) { if(options[i].innerText.trim()=='在校/应届') { options[i].click(); String('clicked_在校/应届') } } String('not_found')"
	return resultText
end tell