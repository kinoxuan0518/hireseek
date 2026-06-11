tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var opts=doc.querySelectorAll('.option'); var found='notfound'; for(var i=0;i<opts.length;i++){if(opts[i].innerText.trim()=='25年毕业'){opts[i].click();found='clicked';break}} String(found)"
	return resultText
end tell