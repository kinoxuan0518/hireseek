on run argv
	set targetName to item 1 of argv
	
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
		
		-- Remove old panel
		set js0 to "(function(){var rc=document.querySelector('.resume-content');if(rc){rc.remove();return 'removed';}return 'no_panel';})()"
		set r0 to execute tab_ javascript js0
		delay 1
		
		-- Click candidate
		set js1 to "(function(){var items=document.querySelectorAll('.geek-item');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('" & targetName & "')!=-1){items[i].click();return 'clicked';}}return 'not_found';})()"
		set r1 to execute tab_ javascript js1
		delay 2
		
		-- Click 附件简历 A tag
		set js2 to "(function(){var all=document.querySelectorAll('a');for(var i=0;i<all.length;i++){if(all[i].innerText.indexOf('附件简历')!=-1&&all[i].offsetHeight>0){all[i].click();return 'clicked_attach';}}return 'not_found';})()"
		set r2 to execute tab_ javascript js2
		delay 3
		
		-- Read full text
		set js3 to "(function(){var f=document.querySelector('.attachment-iframe');if(!f){return 'no_iframe';}var doc=f.contentDocument;var body=doc.body.innerText;if(body&&body.length>200){return body.substring(0,3000);}var tl=doc.querySelector('.textLayer');if(!tl){return 'no_textLayer';}var spans=tl.querySelectorAll('span');var r=[];for(var i=0;i<spans.length;i++){var t=spans[i].textContent.trim();if(t){r.push(t);}}return r.join(' ').substring(0,3000);})()"
		set r3 to execute tab_ javascript js3
		
		return r0 & "||" & r1 & "||" & r2 & "||" & r3
	end tell
end run