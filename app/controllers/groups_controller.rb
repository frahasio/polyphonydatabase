class GroupsController < ApplicationController
  # Keep these updated, otherwise changing the
  # page size will drop existing filters.
  PERSISTENT_PARAMS = %i[
    composer
    composer_country
    composition_type
    even_odd
    function
    has_edition
    has_recording
    language
    order
    q
    sort
    source
    tone
    voices
    voicing
  ].freeze

  def index
    @groups = sort(GroupFilter.filter(params))
      .page(params[:page])
      .per(params[:page_size])
      .includes(
        :composers,
        :editions,
        :functions,
        :recordings,
        compositions: [
          :composition_type,
          inclusions: [
            :attributions,
            :clef_combination,
            :source,
          ],
        ],
      )
  end

  private

  # Add more sort options here as needed
  def sort(scope)
    case params[:sort]
    when "title"
      scope.order(display_title: sort_order)
    else
      scope.order(:display_title)
    end
  end
end
