tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var btns=doc.querySelectorAll('.btn.confirm-btn'); if(btns.length>0){btns[0].click();String('confirmed')}else{String('no_confirm_btn')}"
	return resultText
end tell