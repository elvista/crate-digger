type Vector={x:number;y:number};
/** Vertical gestures never become accidental left/right decisions. */
export function discoveryGesture(offset:Vector,velocity:Vector):'playlist'|'save'|'skip'|null{
 const direction=Math.hypot(offset.x,offset.y)>12?offset:velocity;
 if(Math.abs(direction.y)>Math.abs(direction.x)*1.15)return offset.y < -80||velocity.y < -650?'playlist':null;
 const swipe=Math.abs(offset.x)>100?offset.x:Math.abs(velocity.x)>700?velocity.x:0;
 return swipe?swipe>0?'save':'skip':null;
}
