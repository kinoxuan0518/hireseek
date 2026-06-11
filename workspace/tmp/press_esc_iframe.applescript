tell application "Google Chrome"
	tell tab 2 of window 1 to execute javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var e=new KeyboardEvent('keydown',{key:'Escape'}); doc.dispatchEvent(e); String('esc_pressed')"
end tell