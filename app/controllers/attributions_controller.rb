class AttributionsController < ApplicationController
  def index

  end

  def assign
    params[:attribution_ids].each do |attrib_id|
      composer = Composer.find(params[:composer_id])
      attrib = Attribution.find(attrib_id)

      if params[:incorrectly_attributed]
        attrib.update_attributes(
          anonym: nil,
          alias: nil,
          composer: composer,
          incorrectly_attributed: true,
        )
      else
        composer_alias = Alias.find_or_create_by!(
          composer: composer,
          anonym: attrib.anonym,
        )

        attrib.update_attributes(
          anonym: nil,
          alias: composer_alias,
          composer: nil,
          incorrectly_attributed: false,
        )
      end
    end

    redirect_to attributions_path
  end
end
