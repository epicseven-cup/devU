import submissionService from '../submission/submission.service'
import submissionScoreService from '../submissionScore/submissionScore.service'
import submissionProblemScoreService from '../submissionProblemScore/submissionProblemScore.service'
import nonContainerAutograderService from '../nonContainerAutoGrader/nonContainerAutoGrader.service'
import containerAutograderService from '../containerAutoGrader/containerAutoGrader.service'
import assignmentProblemService from '../assignmentProblem/assignmentProblem.service'
import assignmentScoreService from '../assignmentScore/assignmentScore.service'
import courseService from '../course/course.service'
import { addJob, createCourse, uploadFile, pollJob } from '../../tango/tango.service'

import { SubmissionScore, SubmissionProblemScore, AssignmentScore } from 'devu-shared-modules'
import { checkAnswer } from '../nonContainerAutoGrader/nonContainerAutoGrader.grader'
import { serialize as serializeNonContainer } from '../nonContainerAutoGrader/nonContainerAutoGrader.serializer'
import { serialize as serializeAssignmentScore } from '../assignmentScore/assignmentScore.serializer'
import { downloadFile, initializeMinio } from '../../fileStorage'

import crypto from 'crypto'
import environment from '../../environment'

export async function grade(submissionId: number) {
    const submission = await submissionService.retrieve(submissionId)
    if (!submission) return null

    const assignmentId = submission.assignmentId

    const content = JSON.parse(submission.content)
    const form = content.form
    const filepaths: string[] = content.filepaths //Using the field name that was written on the whiteboard for now

    const nonContainerAutograders = await nonContainerAutograderService.listByAssignmentId(assignmentId)
    //const containerAutograders = await containerAutograderService.listByAssignmentId(assignmentId)
    const assignmentProblems = await assignmentProblemService.list(assignmentId)

    
    let score = 0
    let feedback = ''
    let allScores = [] //This is the return value, the serializer parses it into a GraderInfo object for the controller to return

    //Run Non-Container Autograders
    for (const question in form) { 
        const nonContainerGrader = nonContainerAutograders.find(grader => grader.question === question)
        const assignmentProblem = assignmentProblems.find(problem => problem.problemName === question)

        if (nonContainerGrader && assignmentProblem) {
            const [problemScore, problemFeedback] = checkAnswer(form[question], serializeNonContainer(nonContainerGrader)) 
            score += problemScore
            feedback += problemFeedback + '\n'

            const problemScoreObj: SubmissionProblemScore = {
                submissionId: submissionId,
                assignmentProblemId: assignmentProblem.id,
                score: problemScore,
                feedback: problemFeedback 
            }
            allScores.push(await submissionProblemScoreService.create(problemScoreObj))
        }
    }

    //Run Container Autograders
    try {
        const {graderData, makefileData, autogradingImage, timeout} = await containerAutograderService.getGraderByAssignmentId(assignmentId)
        const bucketName = await courseService.retrieve(submission.courseId).then((course) => {
            return course ? (course.number + course.semester + course.id).toLowerCase() : 'submission'
        })
        initializeMinio(bucketName)

        var response = null
        const labName = `${bucketName}-${submission.assignmentId}`
        const optionFiles = []
        const openResponse = await createCourse(labName)
        if (openResponse) {
            if (!(openResponse.files["Graderfile"]) || openResponse.files["Graderfile"] !== crypto.createHash('md5').update(graderData).digest('hex')) {
                await uploadFile(labName, graderData, "Graderfile")
            }
            if (!(openResponse.files["Makefile"]) || openResponse.files["Makefile"] !== crypto.createHash('md5').update(makefileData).digest('hex')) {
                await uploadFile(labName, makefileData, "Makefile")
            }
            for (const filepath of filepaths){
                const buffer = await downloadFile(bucketName, filepath)
                if (await uploadFile(labName, buffer, filepath)) {
                    optionFiles.push({localFile: filepath, destFile: filepath})
                }
            }
            console.log(environment.apiUrl)
            console.log(labName)
            const jobOptions = {
                image: autogradingImage,
                files: [{localFile: "Graderfile", destFile: "autograde.tar"}, 
                        {localFile: "Makefile", destFile: "Makefile"},]
                        .concat(optionFiles),
                jobName: `${labName}-${submissionId}`,
                output_file: `${labName}-${submissionId}-output.txt`,
                timeout: timeout,
                callback_url: `http://api:3001/grade/callback/${labName}-${submissionId}-output.txt`
            }
            response = await addJob(labName, jobOptions)
        }
    } catch (e) {
        console.error(e)
    }
    //remember, immediate callback is made when job has been added to queue, not sure how we're handling the rest of it yet though lmao

    //Grading is finished. Create SubmissionScore and AssignmentScore and save to db.
    const scoreObj: SubmissionScore = {
        submissionId: submissionId,
        score: score,       //Sum of all SubmissionProblemScore scores
        feedback: feedback  //Concatination of SubmissionProblemScore feedbacks
    }
    allScores.push(await submissionScoreService.create(scoreObj))

    //PLACEHOLDER AssignmentScore logic. This should be customizable, but for now AssignmentScore will simply equal the latest SubmissionScore
    const assignmentScoreModel = await assignmentScoreService.retrieveByUser(submission.assignmentId, submission.userId)
    if (assignmentScoreModel) { //If assignmentScore already exists, update existing entity
        const assignmentScore = serializeAssignmentScore(assignmentScoreModel)
        assignmentScore.score = score
        assignmentScoreService.update(assignmentScore)

    } else { //Otherwise make a new one
        const assignmentScore: AssignmentScore = {
            assignmentId: submission.assignmentId,
            userId: submission.userId,
            score: score,
        }
        await assignmentScoreService.create(assignmentScore)
    }

    return response
}


export async function tangoCallback(outputFile: string) {
    console.log('goot!')
    //Output filename consists of 4 sections separated by hyphens. + and () only for visual clarity, not a part of the filename
    //(course.number+course.semester+course.id)-(assignment.id)-(submission.id)-(output.txt)
    const filenameSplit = outputFile.split('-')
    const labName = `${filenameSplit[0]}-${filenameSplit[1]}`
    const assignmentId = Number(filenameSplit[1])
    const submissionId = Number(filenameSplit[2])

    const response = await pollJob(labName, outputFile)
    if (typeof response !== 'string') {
        throw new Error('Autograder output file not found')
    }
    const splitResponse = response.split(/\r\n|\r|\n/)
    const scores = (JSON.parse(splitResponse[splitResponse.length - 2])).scores

    let score = 0
    const assignmentProblems = await assignmentProblemService.list(assignmentId)
    const submissionScore = await submissionScoreService.retrieve(submissionId)
    for (const question in scores) {
        const assignmentProblem = assignmentProblems.find(problem => problem.problemName === question)
        if (assignmentProblem) {
            const problemScoreObj: SubmissionProblemScore = {
                submissionId: submissionId,
                assignmentProblemId: assignmentProblem.id,
                score: Number(scores[question]),
                feedback: '' //Not sure what to do for individual problemscore feedback 
            }
            submissionProblemScoreService.create(problemScoreObj)
            score += Number(scores[question])
        }
    }
    if (submissionScore) {
        submissionScore.score += score
        submissionScore.feedback += `\n${response}`

        submissionScoreService.update(submissionScore)
    } else {
        const scoreObj: SubmissionScore = {
            submissionId: submissionId,
            score: score,       //Sum of all SubmissionProblemScore scores
            feedback: response  //Feedback from Tango
        }
        submissionScoreService.create(scoreObj)
    }

    return {output: response}
}

export default { grade, tangoCallback }