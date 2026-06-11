tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	
	set js1 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_resume_file.js")
	set r1 to execute tab_ javascript js1
	delay 3
	
	set js2 to "(function(){var f=document.querySelector('.attachment-iframe');if(!f){return 'no_iframe';}var src=f.getAttribute('src');return 'iframe_src='+src.substring(0,100);})()"
	set r2 to execute tab_ javascript js2
	
	set js3 to "(function(){var f=document.querySelector('.attachment-iframe');if(!f){return 'no_iframe';}var doc=f.contentDocument;if(!doc){return 'no_doc';}var tl=doc.querySelector('.textLayer');if(!tl){return 'no_textLayer_len='+doc.body.innerText.length;}var spans=tl.querySelectorAll('span');var r='';for(var i=0;i<spans.length&&i<30;i++){var t=spans[i].textContent.trim();if(t)r+=t+' ';}return 'text:'+r.substring(0,500);})()"
	set r3 to execute tab_ javascript js3
	
	return r1 & " | " & r2 & " | " & r3
end tell