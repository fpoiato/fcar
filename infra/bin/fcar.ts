import { App, Tags } from 'aws-cdk-lib';

const app = new App();

Tags.of(app).add('project', 'fcar');

// As stacks são adicionadas pelas issues da Fase 0 (#3, #4, #5, #6, #8, #9, #10).
app.synth();
