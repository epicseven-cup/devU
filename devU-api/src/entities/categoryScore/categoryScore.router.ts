//Libraries
import express from 'express'

//validators
import validator from './categoryScore.validator'
import { asInt } from '../../middleware/validator/generic.validator'

//Controller
import CategoryScoreController from './categoryScore.controller'

const Router = express.Router()

/**
 * @swagger
 * /category-score:
 *  get:
 *      summary: Retrieve a list of all category scores
 *      tags:
 *        - CategoryScores
 *      responses:
 *        '200':
 *          description: OK
 */ 
Router.get('/', CategoryScoreController.get)


/**
 * @swagger
 * /category-score/{id}:
 *  get:
 *      summary: Retrieve a single category score
 *      tags:
 *        - CategoryScores
 *      responses:
 *        '200':
 *          description: OK
 *      parameters:
 *        - name: id
 *          in: path
 *          required: true
 *          schema:
 *            type: integer
 */
Router.get('/:id', asInt(), CategoryScoreController.detail)

/**
 * @swagger
 * /category-score:
 *  post:
 *      summary: Create a category score
 *      tags:
 *        - CategoryScores
 *      responses:
 *        '200':
 *          description: OK
 *      requestBody:
 *        content:
 *          application/x-www-form-urlencoded:
 *            schema:
 *              $ref: '#/components/schemas/CategoryScore'
 */
Router.post('/', validator, CategoryScoreController.post)

/**
 * @swagger
 * /category-score/{id}:
 *  put:
 *      summary: Update a category score
 *      tags:
 *        - CategoryScores
 *      responses:
 *        '200':
 *          description: OK
 *      parameters:
 *        - name: id
 *          in: path
 *          required: true
 *          schema:
 *            type: integer
 *      requestBody:
 *        content:
 *          application/x-www-form-urlencoded:
 *            schema:
 *              $ref: '#/components/schemas/CategoryScore'
 */
Router.put('/:id', validator, asInt(), CategoryScoreController.put)

/**
 * @swagger
 * /category-score/{id}:
 *  delete:
 *      summary: Delete a category score
 *      tags:
 *        - CategoryScores
 *      responses:
 *        '200':
 *          description: OK
 *      parameters:
 *        - name: id
 *          in: path
 *          required: true
 *          schema:
 *            type: integer
 */
Router.delete('/:id', asInt(), CategoryScoreController._delete)

export default Router