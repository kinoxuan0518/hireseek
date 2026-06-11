tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var btn=doc.querySelector('.btn.confirm-btn'); if(btn) { btn.click(); String('confirmed') } else { String('not_found') }"
	return resultText
end tell