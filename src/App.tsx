import './App.css';
import { Application } from '@playcanvas/react';
import { FILLMODE_NONE, RESOLUTION_AUTO } from 'playcanvas';
import Scene from './Scene';

function App() {
  return (
    <div className="container">
      <Application
        fillMode={FILLMODE_NONE}
        resolutionMode={RESOLUTION_AUTO}
        deviceTypes={['webgpu']}
      >
        <Scene />
      </Application>
    </div>
  );
}

export default App;
