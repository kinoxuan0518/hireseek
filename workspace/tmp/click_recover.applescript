tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var recover=doc.querySelector('div.recover'); if(recover&&recover.innerText.indexOf('应用')>=0){recover.click();String('applied')}else{String('not_found')}"
	return resultText
end tell