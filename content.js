const FRAME_RATE = 30;
const RATING_THRESHOLD = 0.06;

function luminance(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    return (r*r + g*g + b*b) / 3;
}

class VarianceCounter {
    constructor() {
        this.count = 0;
        this.sum = 0;
        this.variance = 0;
    }

    record(newVal) {
        this.count++;
        this.sum += newVal;
        if(this.count == 1){
            this.prev = newVal;
            return;
        }

        this.variance += Math.pow(this.prev - newVal, 2);
        this.prev = newVal;
        return;
    }

    getVariance() {
        return this.variance / this.count;
    }

    getAverage() {
        return this.sum / this.count;
    }
}

function compareFrames(prev, curr) {
    let numPixels = prev.length / 4;
    let result = Array(numPixels);
    for(let i = 0; i < numPixels; i++){
        let r = prev[i * 4 + 0];
        let g = prev[i * 4 + 1];
        let b = prev[i * 4 + 2];
        let lum = luminance(r, g, b);

        let nr = curr[i * 4 + 0];
        let ng = curr[i * 4 + 1];
        let nb = curr[i * 4 + 2];
        let nlum = luminance(nr, ng, nb);
        
        result[i] = nlum - lum;
    }

    return result;
}

function compareDeltas(prev, curr) {
    let result = 0;
    for(let i = 0; i < prev.length; i++){
        if(prev[i] > 0 && curr[i] < 0) {
            result += prev[i] - curr[i];
        }
        if(prev[i] < 0 && curr[i] > 0) {
            result += curr[i] - prev[i];
        }
    }

    return result / prev.length;
}

function injectDiv() {
    const div = document.createElement("DIV");
    div.style.position="fixed";
    div.style.left=0;
    div.style.top=0;
    div.style.right=0;
    div.style.bottom=0;
    div.style.overflow="scroll";
    div.innerHTML = `
    <canvas id="indicator" width=20 height=20></canvas>
    <canvas id="canvas" width=480 height=360></canvas>
    <canvas id="canvas2" width=480 height=360></canvas>
    <canvas id="canvas3" width=480 height=360></canvas>
    <canvas id="bar" width=600 height=20></canvas>
    <input id="threshold" type="range" min=0 max=0.3 step=0.01 value=0.06>`
    document.body.appendChild(div);
}

function injectTopBar() {
    const div = document.createElement("DIV");
    div.style.position="fixed";
    div.style.left=0;
    div.style.top=0;
    div.style.right=0;
    div.style.height="10px";
    div.style.zIndex = 10000;
    const indicator = document.createElement("CANVAS");
    indicator.width = 600;
    indicator.height = 20;
    indicator.style.margin = 0;
    indicator.style.width="100%";
    indicator.style.height="10px";
    indicator.style.left = 0;
    indicator.style.top = 0;
    indicator.id = "bar";
    div.appendChild(indicator);
    document.body.appendChild(div);
}
injectTopBar();

function injectFullScreenCover() {
    const div = document.createElement("DIV");
    div.style.position = "fixed";
    div.style.left = 0;
    div.style.right = 0;
    div.style.top = "10px";
    div.style.bottom = 0;
    div.style.zIndex = 9999;
    div.style.backgroundColor = "white";
    div.style.display = "none";
    div.id="fullScreenCover";

    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.flexDirection = "column";
    
    div.innerHTML = `
        <p style="font-size: 30px">We covered up this part of the video because we think this can cause a seizure.</p>
        <canvas id="canvas" style="width:240px;height:180px;"></canvas>
        <p id="rating" style="font-size: 20px"></p>
        <br>
    `
    
    const a = document.createElement("A");
    a.onclick = disableFullScreenCover;
    a.href = "javascript:void(0)";
    a.style.fontSize = "20px";
    a.textContent = "Please click here to disable this.";
    div.appendChild(a);
    
    document.body.appendChild(div);
}
injectFullScreenCover();

function disableFullScreenCover() {
    document.getElementById("fullScreenCover").dataset.disabled = true;
    hideFullScreenCover();
}

function showFullScreenCover(){
    if(document.getElementById("fullScreenCover").dataset.disabled) return;
    document.getElementById("fullScreenCover").style.display = "flex";
}

function hideFullScreenCover() {
    document.getElementById("fullScreenCover").style.display = "none";
}

class VideoAnalyzer {
    constructor(videoElem) {
        //injectDiv();
        this.video = videoElem; //TODO: clone video off screen instead
        this.shadow = this.video;
        this.shadow.muted = true;
        console.log(this.shadow);
        this.canvas = document.createElement("canvas");
        this.canvas.width = 480;
        this.canvas.height = 360;
        this.ctx = this.canvas.getContext("2d");
        this.canvas2 = document.getElementById("canvas");
        this.canvas2.width = 480;
        this.canvas2.height = 360;
        this.ctx2 = this.canvas2.getContext("2d");
        this.canvas3 = document.createElement("canvas");
        this.canvas3.width = 480;
        this.canvas3.height = 360;
        this.ctx3 = this.canvas3.getContext("2d");
        //this.indicatorCtx = document.getElementById("indicator").getContext("2d");

        this.ratingText = document.getElementById("rating");

        this.barCanvas = document.getElementById("bar");
        this.barCtx = this.barCanvas.getContext("2d");

        this.video.addEventListener("seeked", () => this.handleSeek());
        this.video.addEventListener("play", () => this.handleSeek());
        this.counter = 0;

        this.variances = [];
        this.ratings = [];
        this.canToggleCover = true;
        this.toggleCoverTimeout = null;
        console.log("done initialization");
        window.onhashchange = () => {
            console.log("detected change");
            this.resetStats();
        }
    }
    
    resetStats() {
        this.variances = [];
        this.ratings = [];
        document.getElementById("fullScreenCover").dataset.disabled = false;
    }

    handleSeek() {
        if(this.shadow !== this.video)
            this.shadow.currentTime = this.video.currentTime;
        if(this.shadow.paused || this.shadow.ended) {
            this.startAnalysis();
        }
    }

    getShadowFrame() {
        this.ctx.drawImage(this.shadow, 0, 0, 480, 360);
        return this.ctx.getImageData(0, 0, 480, 360);
    }

    startAnalysis() {
        this.shadow.play();
        this.timerCallback();
    }

    stopAnalysis() {
        this.shadow.pause();
    }

    showBar() {
        const barWidth = 600 / this.shadow.duration;
        const threshold = RATING_THRESHOLD;
        for(let i = 0; i < this.shadow.duration; i++){
            let color = "green";
            if(!this.ratings[i] || this.ratings[i].count < 5) {
                color = "blue";
            }else{
                if(this.ratings[i].getAverage() > threshold){
                    color = "red";
                }
            }

            this.barCtx.fillStyle = color;
            this.barCtx.fillRect(barWidth * i, 0, barWidth, 20);
        }
        this.barCtx.fillStyle = "black";
        this.barCtx.fillRect(this.video.currentTime * barWidth, 0, 2, 20);
    }

    showDeltas(prev, curr) {
        let id = this.ctx3.createImageData(480, 360);
        let d = id.data;
        let result = [];
        for(let i = 0; i < prev.length; i++){
            if(!result[i]) result[i] = 0;
            if(prev[i] > 0.05 && curr[i] < 0.05) {
                result[i] += prev[i] - curr[i];
            }
            if(prev[i] < 0.05 && curr[i] > 0.05) {
                result[i] += curr[i] - prev[i];
            }
        }
        for(let i = 0; i < prev.length; i++){
            let color = Math.min(255, result[i] * 255);
            if(color < 170) color = 0;
            d[4*i + 0] = color;
            d[4*i + 1] = color;
            d[4*i + 2] = color;
            d[4*i + 3] = 255;
        }

        this.ctx3.putImageData(id, 0, 0);
    }

    timerCallback () {
        this.counter++;
        const markedFrame = this.getShadowFrame();
        const frame = markedFrame.data.slice(0);
        const numPixels = frame.length / 4;
        let rating = 0;
        if(this.prevFrame) {
            const deltas = compareFrames(this.prevFrame, frame);
            for(let i = 0; i < deltas.length; i++){
                for(let j = 0; j < 3; j++){
                    markedFrame.data[i*4 + j] = 0;
                }
                if(deltas[i] > 0.1) {
                    markedFrame.data[i * 4 + 1] = 255;
                }else if(deltas[i] < -0.1){
                    markedFrame.data[i * 4 + 2] = 255;
                }
            }

            if(this.prevDeltas) {
                rating = compareDeltas(this.prevDeltas, deltas);
                this.showDeltas(this.prevDeltas, deltas);
            }
            this.prevDeltas = deltas;
        }

        if(this.counter % 10 === 0)
            this.ctx2.putImageData(markedFrame, 0, 0);

        this.prevFrame = frame;

        //calculate luminance
        let totalLuminance = 0;
        for(let i = 0; i < numPixels; i++){
            let r = frame[i * 4 + 0];
            let g = frame[i * 4 + 1];
            let b = frame[i * 4 + 2];
            
            let lum = luminance(r, g, b);
            totalLuminance += lum;
        }
        const avgLuminance = totalLuminance / numPixels;
        const d = (Math.floor(255 - avgLuminance*255));
        const r = (Math.floor(255 - rating * 255));

        // //show luminance in indicator
        // this.indicatorCtx.fillStyle = "rgb("+d+","+d+","+d+")";
        // this.indicatorCtx.fillRect(0, 0, 10, 20);
        
        // //show rating in indicator
        // this.indicatorCtx.fillStyle = "rgb("+r+","+r+","+r+")";
        // this.indicatorCtx.fillRect(0, 0, 10, 10);

        //record calculated variance
        const second = Math.floor(this.shadow.currentTime);
        if(!this.variances[second]){
            this.variances[second] = new VarianceCounter();
        }
        if(!this.ratings[second]) {
            this.ratings[second] = new VarianceCounter();
        }
        this.variances[second].record(avgLuminance);
        this.ratings[second].record(rating);
        
        if(this.ratings[second].count > 10 && this.ratings[second].getAverage() > RATING_THRESHOLD) {
            this.canToggleCover = false;
            if(this.toggleCoverTimeout) {
                clearTimeout(this.toggleCoverTimeout);
            }
            this.toggleCoverTimeout = setTimeout(() => {
                this.canToggleCover = true;
            }, 1000);
            showFullScreenCover();
        }else if(this.ratings[second].count > 10 && this.canToggleCover) {
            hideFullScreenCover();
        }

        this.ratingText.textContent = "Variance: " + (this.ratings[second].getAverage() * 256).toFixed(2) + " cd/m^2";

        // if(this.ratings[second].getAverage() > 0.05) {
        //     this.indicatorCtx.fillStyle = "red";
        // }else{
        //     this.indicatorCtx.fillStyle = "white";
        // }
        // this.indicatorCtx.fillRect(10, 0, 10, 20);

        this.showBar();

        setTimeout(() => {
            this.timerCallback()
        }, 1);
    }
}

const videoCheck = setInterval(() => {
    const video = document.querySelector("video");
    if(video !== null) {
        clearInterval(videoCheck);
        va = new VideoAnalyzer(video);
        va.startAnalysis();
    }else{
        console.log("video not found");
    }
}, 1000);