tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; String(doc.querySelectorAll('[class*=dialog],[class*=modal],[class*=popup]').length+','+doc.querySelectorAll('.geek-greet').length+','+(doc.body.innerText.indexOf('发送')>=0))"
	return resultText
end tell