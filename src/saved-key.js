// A saved-state mask, never the secret itself. Only an explicit replacement is submitted.
export function savedKey(field,button){
 let configured=false;
 function display(value){configured=!!value;field.readOnly=configured;field.value=configured?'••••••••':'';button.hidden=!configured;button.textContent='更换 Key';field.setAttribute('aria-label',configured?'API Key 已保存，内容已隐藏':'填写 API Key');}
 button.onclick=()=>{if(field.readOnly){field.readOnly=false;field.value='';button.textContent='取消更换';field.focus();}else display(configured);};
 return {display,value:()=>field.readOnly?'':field.value};
}
