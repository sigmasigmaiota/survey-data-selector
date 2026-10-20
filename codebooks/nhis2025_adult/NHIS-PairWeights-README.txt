      PUBLIC-USE PAIR WEIGHTS DATA FROM THE NATIONAL HEALTH INTERVIEW SURVEY FILE DOCUMENTATION 
			(FOR USE IN THE PARENT-CHILD-PAIR LEVEL STATISTICAL ANALYSIS)
                                  

 
Backgroud: The National Health Interview Survey (NHIS), conducted by the National Center for Health Statistics (NCHS) since 1957, 
is the principal source of information on the health of the civilian noninstitutionalized US population. The NHIS selects one 
adult (Sample Adult) and, when applicable, one child (Sample Child) randomly within a family (through 2018) or a household 
(2019 and forward). Sampling weights for the separate analysis of data from Sample Adults and Sample Children are provided 
annually by NCHS.There is growing interest in the analysis of parent-child pair data using NHIS, which necessitated the development 
of appropriate analytic weights. Since NHIS does not sample a parent-child pair from all possible parent-child pairs within a 
family or a household, the sampling weights for specific dyads (for example, father-child and mother-child) cannot be developed. 
However, sampling weights for adult-child pairs can be created more generally. Once adult-child pair sampling weights are created, 
domain estimation methods (that is, statistical analysis for subpopulations or subgroups) can produce estimates separately for 
mother-child and father-child pairs since mother-child and father-child pairs are a subset of all adult-child pairs. 
To meet the needs of data users, NCHS developed adult-child pair sampling weights for use in the analysis of mother-child 
and father-child pair data of NHIS (2019 and forward). This readme.txt file contains information on the public-use NHIS pair weights
data.

* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * ** * * * * * * * * * * *
The public-use pair weights data from different survey years have the same data structure. Each year’s pair weights are in a file that 
includes a household ID and the pair weights.
 
(1) File name: final_pair_weight&year.sas7bdat, where &year is the year of the NHIS survey. For example, final_pair_weight2019.sas7bdat
    is the file that contains the pair weights of the 2019 NHIS. 
(2) Variable names: HHX (household ID, for linking to Sample Adult and Sample Child data) and final_pair_weight (the pair weights).

* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * ** * * * * * * * * * * *
To use the public-use pair weights data

After linking the pair weights to Sample Adult and Sample Child datasets using HHX, users can derive mother-child/father-child/non-parent-child pairs 
using variables SAPARENTSC_A (Sample Adult relationship to Sample Child) and SEX_A (Sex of Sample Adult). These two variables are available in the Sample Adult public-use data files. 
The SAS code and a few analytical examples demonstrating how to conduct statistical analysis using the pair weights can be found in the NCHS report 
titled "Developing sampling weights for statistical analysis of parent-child pair data from the National Health Interview Survey", 
by Guangyu Zhang, Yulei He, Van Parsons, Chris Moriarity, Stephen Blumberg, Benjamin Zablotsky, Aaron Maitland, Matthew Bramlett, Jonaki Bose.  
 
The pair weights are for use in the analysis of NHIS mother-child or father-child pair data. These weights can be used when data from a mother 
(or father) are being incorporated in a child-level analysis as an exposure or independent variable, or if a joint child-mother/father outcome is 
being used in the analysis. The pair weights should not be used in the statistical analyses focusing exclusively on all Sample Adults (or all Sample Children); 
instead, the Sample Adult (or Sample Child) sampling weights developed by NCHS should be used for the corresponding analyses. 
For example, Sample Child sampling weights should be used for an analysis of a health outcome for children using data from all Sample Children 
(that is, including those whose families did not complete a Sample Adult interview). Although the Sample Adult (and Sample Child) sampling weights 
are correlated with the pair weights, pair-level statistical analyses should use the pair-level sampling weights as they incorporate the sampling probabilities
of both the Sample Adult and the Sample Child and are adjusted for pair-level nonresponse. Using Sample Adult weights or Sample Child weights for pair-level 
statistical analysis may lead to biased results.  
 
* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * ** * * * * * * * * * * *
 
CAUTION - The SAS code in the NCHS report mentioned above uses the 2019 NHIS Sample Adult and Sample Child data for illustration. For NHIS data in different years, variable names may change. 
Users should check the log file if errors occur when applying the SAS code for different years of NHIS Sample Adult and Sample Child data. 
                                                                                                
   For questions, suggestions, or comments concerning NHIS pair weights data, please
   contact the Divsion of Health Interview Survey
   (301) 458-****  or by email at ***@cdc.gov. 

   