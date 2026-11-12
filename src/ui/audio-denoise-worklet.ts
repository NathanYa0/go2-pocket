/** Speech-band spectral suppression for steady motor/room noise. No network service. */
export const DENOISE_WORKLET_CODE = String.raw`
class DenoiseRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 512; this.hop = 256;
    this.input = []; this.overlap = new Float64Array(512);
    this.noise = new Float64Array(512); this.gain = new Float64Array(512).fill(1);
    this.window = Float64Array.from({length:512}, (_,i) => Math.sin(Math.PI*i/512));
    this.frames = 0;
    this.calibration = Math.ceil(sampleRate * 0.4 / this.hop);
  }
  fft(re, im, inverse) {
    const n = re.length;
    for (let i=1,j=0;i<n;i++) {
      let bit=n>>1;
      for (;j&bit;bit>>=1) j^=bit;
      j^=bit;
      if(i<j) { let v=re[i];re[i]=re[j];re[j]=v;v=im[i];im[i]=im[j];im[j]=v; }
    }
    for(let len=2;len<=n;len*=2) {
      const angle=(inverse?2:-2)*Math.PI/len;
      for(let start=0;start<n;start+=len) {
        for(let j=0;j<len/2;j++) {
          const c=Math.cos(angle*j),s=Math.sin(angle*j),a=start+j,b=a+len/2;
          const r=re[b]*c-im[b]*s,v=re[b]*s+im[b]*c;
          re[b]=re[a]-r;im[b]=im[a]-v;re[a]+=r;im[a]+=v;
        }
      }
    }
    if(inverse) for(let i=0;i<n;i++) { re[i]/=n;im[i]/=n; }
  }
  frame() {
    const re=Float64Array.from(this.input.slice(0,this.size),(v,i)=>v*this.window[i]);
    const im=new Float64Array(this.size);
    this.fft(re,im,false);
    this.frames++;
    const learning=this.frames<=this.calibration;
    for(let i=0;i<this.size;i++) {
      const power=re[i]*re[i]+im[i]*im[i];
      if(learning) this.noise[i]+=(power-this.noise[i])/this.frames;
      else if(power<this.noise[i]*1.5) this.noise[i]=0.98*this.noise[i]+0.02*power;
      const hz=Math.min(i,this.size-i)*sampleRate/this.size;
      const target=(hz<150 || hz>3800 || learning)?0:Math.max(0.04,1-1.6*this.noise[i]/Math.max(power,1e-12));
      this.gain[i]=learning?0:0.35*this.gain[i]+0.65*target;
      re[i]*=this.gain[i];im[i]*=this.gain[i];
    }
    this.fft(re,im,true);
    for(let i=0;i<this.size;i++) this.overlap[i]+=re[i]*this.window[i];
    if(!learning) this.port.postMessage(Float32Array.from(this.overlap.slice(0,this.hop)));
    this.overlap.copyWithin(0,this.hop);this.overlap.fill(0,this.hop);
    this.input.splice(0,this.hop);
  }
  process(inputs) {
    const channel=inputs[0] && inputs[0][0];
    if(channel) {
      for(const value of channel) this.input.push(value);
      while(this.input.length>=this.size) this.frame();
    }
    return true;
  }
}
registerProcessor('denoise-recorder',DenoiseRecorder);
`;
