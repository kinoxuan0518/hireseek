tell application "Google Chrome"
	tell tab 2 of window 1 to execute javascript "var e=new KeyboardEvent('keydown',{key:'Escape'}); document.dispatchEvent(e); String('esc_pressed')"
end tell