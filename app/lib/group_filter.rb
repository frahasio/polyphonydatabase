class GroupFilter
  def self.filter(params)
    self.new(params).filter
  end

  def initialize(params)
    @params = params
  end

  def filter
    groups = Group.distinct
    groups = search(groups)
    groups = composition_even_odd(groups)
    groups = composition_type(groups)
    groups = composition_tone(groups)
    groups = function(groups)
    groups = composer(groups)
    groups = composer_country(groups)
    groups = title_language(groups)
    groups = voices(groups)
    groups = voicing(groups)
    groups = source(groups)
    groups = has_edition?(groups)
    has_recording?(groups)
  end

private

  attr_reader :params

  def search(groups)
    return groups if (query = params[:q]).blank?

    tables = %i[
      attributions
      composers
      editions
      editors
      performers
      recordings
      sources
      titles
    ]

    groups = groups.left_outer_joins(tables)

    search_sql = ([:groups] + tables).map { |table|
      "#{table}.search_vector @@ websearch_to_tsquery('english', :query)"
    }.join(" OR ")

    groups.where(search_sql, query:)
  end

  def composition_type(groups)
    return groups if params[:composition_type].blank?
    groups.left_outer_joins(:composition_types).where(composition_types: {id: params[:composition_type]})
  end

  def composition_tone(groups)
    return groups if params[:tone].blank?
    groups.left_outer_joins(:compositions).where(compositions: {tone: params[:tone]})
  end

  def composition_even_odd(groups)
    return groups if params[:even_odd].blank?
    groups.left_outer_joins(:compositions).where(compositions: {even_odd: params[:even_odd]})
  end

  def function(groups)
    return groups if params[:function].blank?
    groups.left_outer_joins(:functions).where(functions: {id: params[:function]})
  end

  def composer(groups)
    return groups if params[:composer].blank?
    groups.left_outer_joins(:composers).where(composers: {id: params[:composer]})
  end

  def composer_country(groups)
    return groups if params[:composer_country].blank?
    groups.left_outer_joins(:composers).where(composers: {birthplace_2: params[:composer_country]})
  end

  def title_language(groups)
    return groups if params[:language].blank?
    groups.left_outer_joins(compositions: :title).where(titles: {language: params[:language]})
  end

  def voices(groups)
    return groups if params[:voices].blank?
    groups.left_outer_joins(:compositions).where(compositions: {number_of_voices: params[:voices]})
  end

  def voicing(groups)
    return groups if params[:voicing].blank?
    groups
      .left_outer_joins(compositions: {inclusions: {clef_combination: :voicings}})
      .where(voicings: {id: params[:voicing]})
  end

  def source(groups)
    return groups if params[:source].blank?
    groups.left_outer_joins(:sources).where(sources: {id: params[:source]})
  end

  def has_edition?(groups)
    return groups if params[:has_edition].blank?
    groups.left_outer_joins(:editions).where.not(editions: {id: nil})
  end

  def has_recording?(groups)
    return groups if params[:has_recording].blank?
    groups.left_outer_joins(:recordings).where.not(recordings: {id: nil})
  end
end
